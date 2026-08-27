#ifndef _WIN32
#define _GNU_SOURCE
#endif
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#include <time.h>
#ifdef __linux__
#include <sched.h>
#endif
#endif

typedef double (*BenchmarkEntry)(void);

static int compare_double(const void *left, const void *right) {
    const double a = *(const double *)left;
    const double b = *(const double *)right;
    return (a > b) - (a < b);
}

static double monotonic_ms(void) {
#ifdef _WIN32
    LARGE_INTEGER frequency, now;
    QueryPerformanceFrequency(&frequency);
    QueryPerformanceCounter(&now);
    return (double)now.QuadPart * 1000.0 / (double)frequency.QuadPart;
#else
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) exit(2);
    return (double)now.tv_sec * 1000.0 + (double)now.tv_nsec / 1000000.0;
#endif
}

static int pin_to_first_allowed_cpu(void) {
#ifdef _WIN32
    DWORD_PTR process_mask = 0;
    DWORD_PTR system_mask = 0;
    if (!GetProcessAffinityMask(GetCurrentProcess(), &process_mask, &system_mask) ||
        process_mask == 0) return -1;
    for (int cpu = 0; cpu < (int)(sizeof(DWORD_PTR) * 8); ++cpu) {
        const DWORD_PTR bit = ((DWORD_PTR)1) << cpu;
        if ((process_mask & bit) != 0) {
            return SetThreadAffinityMask(GetCurrentThread(), bit) != 0 ? cpu : -1;
        }
    }
    return -1;
#elif defined(__linux__)
    cpu_set_t allowed;
    CPU_ZERO(&allowed);
    if (sched_getaffinity(0, sizeof(allowed), &allowed) != 0) return -1;
    for (int cpu = 0; cpu < CPU_SETSIZE; ++cpu) {
        if (CPU_ISSET(cpu, &allowed)) {
            cpu_set_t selected;
            CPU_ZERO(&selected);
            CPU_SET(cpu, &selected);
            return sched_setaffinity(0, sizeof(selected), &selected) == 0 ? cpu : -1;
        }
    }
    return -1;
#else
    return -1;
#endif
}

int main(int argc, char **argv) {
    if (argc != 4) return 1;
    const int warmups = atoi(argv[2]);
    const int runs = atoi(argv[3]);
    if (warmups < 0 || runs < 2) return 1;
    const int affinity_cpu = pin_to_first_allowed_cpu();
#if defined(_WIN32) || defined(__linux__)
    if (affinity_cpu < 0) return 2;
#endif
#ifdef _WIN32
    HMODULE library = LoadLibraryA(argv[1]);
    if (library == NULL) return 2;
    BenchmarkEntry entry = (BenchmarkEntry)(void *)GetProcAddress(library, "vkf_benchmark");
#else
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (library == NULL) return 2;
    BenchmarkEntry entry = (BenchmarkEntry)dlsym(library, "vkf_benchmark");
#endif
    if (entry == NULL) return 2;
    volatile double result = 0.0;
    for (int index = 0; index < warmups; ++index) result = entry();
    double *samples = malloc((size_t)runs * sizeof(double));
    if (samples == NULL) return 2;
    double sum = 0.0;
    for (int index = 0; index < runs; ++index) {
        const double started = monotonic_ms();
        result = entry();
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
    const double median = runs % 2 == 0 ?
        (samples[runs / 2 - 1] + samples[runs / 2]) * 0.5 : samples[runs / 2];
    const int p95_index = (int)ceil(runs * 0.95) - 1;
    printf("{\"runs\":%d,\"affinity_cpu\":%d,\"mean_ms\":%.6f,\"stddev_ms\":%.6f,"
           "\"median_ms\":%.6f,\"p95_ms\":%.6f,\"min_ms\":%.6f,\"max_ms\":%.6f,"
           "\"result\":%.17g,\"samples_ms\":[",
           runs, affinity_cpu, mean, stddev, median, samples[p95_index], samples[0], samples[runs-1], result);
    for (int index = 0; index < runs; ++index) {
        if (index) putchar(',');
        printf("%.6f", samples[index]);
    }
    fputs("]}\n", stdout);
    free(samples);
#ifdef _WIN32
    FreeLibrary(library);
#else
    dlclose(library);
#endif
    return 0;
}
