#include <stdio.h>
#include <string.h>
#ifdef _WIN32
#define BENCH_EXPORT __declspec(dllexport)
#else
#define BENCH_EXPORT __attribute__((visibility("default")))
#endif

BENCH_EXPORT double vkf_benchmark(void) {
    const int n = 8;
    int permutation[12];
    int working[12];
    int rotations[12] = {0};
    for (int index = 0; index < n; ++index) permutation[index] = index;
    int r = n;
    int permutation_index = 0;
    int checksum = 0;
    int maximum_flips = 0;
    for (;;) {
        while (r > 1) {
            rotations[r - 1] = r;
            --r;
        }
        memcpy(working, permutation, (size_t)n * sizeof(int));
        int flips = 0;
        while (working[0] != 0) {
            for (int left = 0, right = working[0]; left < right; ++left, --right) {
                const int temporary = working[left];
                working[left] = working[right];
                working[right] = temporary;
            }
            ++flips;
        }
        if (flips > maximum_flips) maximum_flips = flips;
        checksum += (permutation_index & 1) == 0 ? flips : -flips;
        for (;;) {
            if (r == n) {
                return (double)(checksum * 100 + maximum_flips);
            }
            const int first = permutation[0];
            for (int index = 0; index < r; ++index) permutation[index] = permutation[index + 1];
            permutation[r] = first;
            if (--rotations[r] > 0) break;
            ++r;
        }
        ++permutation_index;
    }
}

int main(void) {
    printf("%.17g\n", vkf_benchmark());
    return 0;
}
