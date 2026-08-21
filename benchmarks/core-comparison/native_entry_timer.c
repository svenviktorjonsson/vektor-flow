#ifndef _WIN32
#define _GNU_SOURCE
#endif
#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <sys/mman.h>
#include <time.h>
#endif

typedef struct VkfRuntimeV6 {
    double (*power_f64)(double, double);
    double (*remainder_f64)(double, double);
    double (*floor_f64)(double);
    double (*sqrt_f64)(double);
    double (*sin_f64)(double);
    double (*cos_f64)(double);
    double (*exp_f64)(double);
    const unsigned char *string_data;
    void *(*allocate)(size_t);
    void (*release)(void *);
    void (*abort_process)(void);
} VkfRuntimeV6;

typedef double (*VkfEntry)(const VkfRuntimeV6 *);

static int compare_double(const void *left, const void *right) {
    const double a = *(const double *)left;
    const double b = *(const double *)right;
    return (a > b) - (a < b);
}

static double monotonic_ms(void) {
#ifdef _WIN32
    LARGE_INTEGER frequency;
    LARGE_INTEGER now;
    QueryPerformanceFrequency(&frequency);
    QueryPerformanceCounter(&now);
    return (double)now.QuadPart * 1000.0 / (double)frequency.QuadPart;
#else
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        perror("clock_gettime");
        exit(2);
    }
    return (double)now.tv_sec * 1000.0 + (double)now.tv_nsec / 1000000.0;
#endif
}

int main(int argc, char **argv) {
    if (argc != 4 && argc != 5) {
        fprintf(stderr, "usage: native_entry_timer code.bin [data.bin] warmups runs\n");
        return 1;
    }
    const int data_argument = argc == 5 ? 2 : 0;
    const int warmups = atoi(argv[argc - 2]);
    const int runs = atoi(argv[argc - 1]);
    if (warmups < 0 || runs < 2) return 1;

    FILE *input = fopen(argv[1], "rb");
    if (input == NULL || fseek(input, 0, SEEK_END) != 0) return 2;
    const long size = ftell(input);
    if (size <= 0 || fseek(input, 0, SEEK_SET) != 0) return 2;
    void *memory =
#ifdef _WIN32
        VirtualAlloc(NULL, (size_t)size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (memory == NULL) return 2;
#else
        mmap(NULL, (size_t)size, PROT_READ | PROT_WRITE,
             MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (memory == MAP_FAILED) {
        perror("mmap");
        return 2;
    }
#endif
    if (fread(memory, 1, (size_t)size, input) != (size_t)size) return 2;
    fclose(input);
#ifdef _WIN32
    DWORD old_protection = 0;
    if (!VirtualProtect(memory, (size_t)size, PAGE_EXECUTE_READ, &old_protection)) return 2;
    FlushInstructionCache(GetCurrentProcess(), memory, (size_t)size);
#else
    if (mprotect(memory, (size_t)size, PROT_READ | PROT_EXEC) != 0) {
        perror("mprotect");
        return 2;
    }
#endif

    unsigned char *literal_data = NULL;
    if (data_argument != 0) {
        FILE *data_input = fopen(argv[data_argument], "rb");
        if (data_input == NULL || fseek(data_input, 0, SEEK_END) != 0) return 2;
        const long data_size = ftell(data_input);
        if (data_size < 0 || fseek(data_input, 0, SEEK_SET) != 0) return 2;
        literal_data = malloc(data_size == 0 ? 1u : (size_t)data_size);
        if (literal_data == NULL) return 2;
        if (data_size > 0 &&
            fread(literal_data, 1, (size_t)data_size, data_input) != (size_t)data_size) return 2;
        fclose(data_input);
    }

    const VkfRuntimeV6 runtime = {
        pow, fmod, floor, sqrt, sin, cos, exp, literal_data, malloc, free, abort
    };
    VkfEntry entry = (VkfEntry)memory;
    volatile double result = 0.0;
    for (int index = 0; index < warmups; ++index) result = entry(&runtime);

    double *samples = malloc((size_t)runs * sizeof(double));
    if (samples == NULL) return 2;
    double sum = 0.0;
    for (int index = 0; index < runs; ++index) {
        const double started = monotonic_ms();
        result = entry(&runtime);
        const double finished = monotonic_ms();
        samples[index] = finished - started;
        sum += samples[index];
    }
    const double mean = sum / runs;
    double squared_deviation = 0.0;
    for (int index = 0; index < runs; ++index) {
        const double delta = samples[index] - mean;
        squared_deviation += delta * delta;
    }
    const double stddev = sqrt(squared_deviation / (runs - 1));
    qsort(samples, (size_t)runs, sizeof(double), compare_double);
    const double median = runs % 2 == 0
        ? (samples[runs / 2 - 1] + samples[runs / 2]) * 0.5
        : samples[runs / 2];
    const int p95_index = (int)ceil(runs * 0.95) - 1;
    printf(
        "{\"runs\":%d,\"mean_ms\":%.6f,\"stddev_ms\":%.6f,"
        "\"median_ms\":%.6f,\"p95_ms\":%.6f,\"min_ms\":%.6f,\"max_ms\":%.6f,"
        "\"result\":%.17g,\"samples_ms\":[",
        runs, mean, stddev, median, samples[p95_index], samples[0], samples[runs - 1], result);
    for (int index = 0; index < runs; ++index) {
        if (index != 0) putchar(',');
        printf("%.6f", samples[index]);
    }
    fputs("]}\n", stdout);
    free(samples);
    free(literal_data);
#ifdef _WIN32
    VirtualFree(memory, 0, MEM_RELEASE);
#else
    munmap(memory, (size_t)size);
#endif
    return 0;
}
