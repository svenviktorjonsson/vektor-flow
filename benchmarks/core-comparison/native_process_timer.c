#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int compare_double(const void *left, const void *right) {
    const double a = *(const double *)left;
    const double b = *(const double *)right;
    return (a > b) - (a < b);
}

static double run_process(
    const char *executable,
    char *command_line,
    HANDLE null_output,
    double ticks_per_ms
) {
    STARTUPINFOA startup = {0};
    PROCESS_INFORMATION process = {0};
    LARGE_INTEGER started;
    LARGE_INTEGER finished;
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = null_output;
    startup.hStdError = null_output;
    char *mutable_command_line = _strdup(command_line);
    if (mutable_command_line == NULL) exit(2);

    QueryPerformanceCounter(&started);
    if (!CreateProcessA(
            executable,
            mutable_command_line,
            NULL,
            NULL,
            TRUE,
            0,
            NULL,
            NULL,
            &startup,
            &process)) {
        fprintf(stderr, "CreateProcess failed: %lu\n", GetLastError());
        free(mutable_command_line);
        exit(2);
    }
    free(mutable_command_line);
    WaitForSingleObject(process.hProcess, INFINITE);
    QueryPerformanceCounter(&finished);

    DWORD exit_code = 0;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    if (exit_code != 0) {
        fprintf(stderr, "child exited with code %lu\n", exit_code);
        exit(3);
    }
    return (double)(finished.QuadPart - started.QuadPart) / ticks_per_ms;
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: native_process_timer executable warmups runs [args...]\n");
        return 1;
    }
    const int warmups = atoi(argv[2]);
    const int runs = atoi(argv[3]);
    if (warmups < 0 || runs < 2) {
        fprintf(stderr, "warmups must be nonnegative and runs must be at least 2\n");
        return 1;
    }

    HANDLE null_output = CreateFileA(
        "NUL",
        GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        NULL,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        NULL
    );
    if (null_output == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "could not open NUL: %lu\n", GetLastError());
        return 2;
    }

    LARGE_INTEGER frequency;
    QueryPerformanceFrequency(&frequency);
    const double ticks_per_ms = (double)frequency.QuadPart / 1000.0;
    double *samples = (double *)malloc((size_t)runs * sizeof(double));
    if (samples == NULL) {
        CloseHandle(null_output);
        return 2;
    }

    size_t command_capacity = strlen(argv[1]) + 3;
    for (int index = 4; index < argc; ++index) command_capacity += strlen(argv[index]) + 3;
    char *command_line = (char *)malloc(command_capacity);
    if (command_line == NULL) {
        free(samples);
        CloseHandle(null_output);
        return 2;
    }
    snprintf(command_line, command_capacity, "\"%s\"", argv[1]);
    for (int index = 4; index < argc; ++index) {
        const size_t used = strlen(command_line);
        snprintf(command_line + used, command_capacity - used, " \"%s\"", argv[index]);
    }

    for (int index = 0; index < warmups; ++index) {
        run_process(argv[1], command_line, null_output, ticks_per_ms);
    }
    double sum = 0.0;
    for (int index = 0; index < runs; ++index) {
        samples[index] = run_process(argv[1], command_line, null_output, ticks_per_ms);
        sum += samples[index];
    }
    CloseHandle(null_output);

    const double mean = sum / (double)runs;
    double squared_deviation = 0.0;
    for (int index = 0; index < runs; ++index) {
        const double delta = samples[index] - mean;
        squared_deviation += delta * delta;
    }
    const double stddev = sqrt(squared_deviation / (double)(runs - 1));
    qsort(samples, (size_t)runs, sizeof(double), compare_double);
    const double median = runs % 2 == 0
        ? (samples[runs / 2 - 1] + samples[runs / 2]) * 0.5
        : samples[runs / 2];
    const int p95_index = (int)ceil((double)runs * 0.95) - 1;

    printf(
        "{\"runs\":%d,\"mean_ms\":%.6f,\"stddev_ms\":%.6f,"
        "\"median_ms\":%.6f,\"p95_ms\":%.6f,\"min_ms\":%.6f,\"max_ms\":%.6f,\"samples_ms\":[",
        runs,
        mean,
        stddev,
        median,
        samples[p95_index],
        samples[0],
        samples[runs - 1]
    );
    for (int index = 0; index < runs; ++index) {
        if (index != 0) putchar(',');
        printf("%.6f", samples[index]);
    }
    fputs("]}\n", stdout);
    free(command_line);
    free(samples);
    return 0;
}
#else
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static int compare_double(const void *left, const void *right) {
    const double a = *(const double *)left;
    const double b = *(const double *)right;
    return (a > b) - (a < b);
}

static double monotonic_ms(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        perror("clock_gettime");
        exit(2);
    }
    return (double)now.tv_sec * 1000.0 + (double)now.tv_nsec / 1000000.0;
}

static double run_process(const char *executable, char *const child_argv[], int null_output) {
    const double started = monotonic_ms();
    const pid_t child = fork();
    if (child < 0) {
        perror("fork");
        exit(2);
    }
    if (child == 0) {
        if (dup2(null_output, STDOUT_FILENO) < 0 || dup2(null_output, STDERR_FILENO) < 0) _exit(126);
        execv(executable, child_argv);
        _exit(127);
    }
    int status = 0;
    while (waitpid(child, &status, 0) < 0) {
        if (errno != EINTR) {
            perror("waitpid");
            exit(2);
        }
    }
    const double finished = monotonic_ms();
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        fprintf(stderr, "child failed with status %d\n", status);
        exit(3);
    }
    return finished - started;
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: native_process_timer executable warmups runs [args...]\n");
        return 1;
    }
    const int warmups = atoi(argv[2]);
    const int runs = atoi(argv[3]);
    if (warmups < 0 || runs < 2) {
        fprintf(stderr, "warmups must be nonnegative and runs must be at least 2\n");
        return 1;
    }
    const int null_output = open("/dev/null", O_WRONLY);
    if (null_output < 0) {
        perror("open /dev/null");
        return 2;
    }
    double *samples = (double *)malloc((size_t)runs * sizeof(double));
    if (samples == NULL) {
        close(null_output);
        return 2;
    }
    char **child_argv = (char **)malloc((size_t)(argc - 2) * sizeof(char *));
    if (child_argv == NULL) {
        free(samples);
        close(null_output);
        return 2;
    }
    child_argv[0] = argv[1];
    for (int index = 4; index < argc; ++index) child_argv[index - 3] = argv[index];
    child_argv[argc - 3] = NULL;

    for (int index = 0; index < warmups; ++index) run_process(argv[1], child_argv, null_output);
    double sum = 0.0;
    for (int index = 0; index < runs; ++index) {
        samples[index] = run_process(argv[1], child_argv, null_output);
        sum += samples[index];
    }
    close(null_output);

    const double mean = sum / (double)runs;
    double squared_deviation = 0.0;
    for (int index = 0; index < runs; ++index) {
        const double delta = samples[index] - mean;
        squared_deviation += delta * delta;
    }
    const double stddev = sqrt(squared_deviation / (double)(runs - 1));
    qsort(samples, (size_t)runs, sizeof(double), compare_double);
    const double median = runs % 2 == 0
        ? (samples[runs / 2 - 1] + samples[runs / 2]) * 0.5
        : samples[runs / 2];
    const int p95_index = (int)ceil((double)runs * 0.95) - 1;
    printf(
        "{\"runs\":%d,\"mean_ms\":%.6f,\"stddev_ms\":%.6f,"
        "\"median_ms\":%.6f,\"p95_ms\":%.6f,\"min_ms\":%.6f,\"max_ms\":%.6f,\"samples_ms\":[",
        runs,
        mean,
        stddev,
        median,
        samples[p95_index],
        samples[0],
        samples[runs - 1]
    );
    for (int index = 0; index < runs; ++index) {
        if (index != 0) putchar(',');
        printf("%.6f", samples[index]);
    }
    fputs("]}\n", stdout);
    free(child_argv);
    free(samples);
    return 0;
}
#endif
