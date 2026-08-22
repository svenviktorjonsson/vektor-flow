#include <math.h>
#include <stdio.h>

#define N 250
#ifdef _WIN32
#define BENCH_EXPORT __declspec(dllexport)
#else
#define BENCH_EXPORT __attribute__((visibility("default")))
#endif

static double matrix_value(int row, int column) {
    const int diagonal = row + column;
    return 1.0 / ((diagonal * (diagonal + 1) / 2) + row + 1);
}

static void multiply_av(const double input[N], double output[N]) {
    for (int row = 0; row < N; ++row) {
        double total = 0.0;
        for (int column = 0; column < N; ++column) {
            total += matrix_value(row, column) * input[column];
        }
        output[row] = total;
    }
}

static void multiply_atv(const double input[N], double output[N]) {
    for (int row = 0; row < N; ++row) {
        double total = 0.0;
        for (int column = 0; column < N; ++column) {
            total += matrix_value(column, row) * input[column];
        }
        output[row] = total;
    }
}

static void multiply_at_av(const double input[N], double output[N]) {
    double temporary[N];
    multiply_av(input, temporary);
    multiply_atv(temporary, output);
}

BENCH_EXPORT double vkf_benchmark(void) {
    double u[N];
    double v[N];
    for (int index = 0; index < N; ++index) u[index] = 1.0;
    for (int iteration = 0; iteration < 10; ++iteration) {
        multiply_at_av(u, v);
        multiply_at_av(v, u);
    }
    double numerator = 0.0;
    double denominator = 0.0;
    for (int index = 0; index < N; ++index) {
        numerator += u[index] * v[index];
        denominator += v[index] * v[index];
    }
    return sqrt(numerator / denominator);
}

int main(void) {
    printf("%.17g\n", vkf_benchmark());
    return 0;
}
