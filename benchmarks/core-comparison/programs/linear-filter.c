#include <stdio.h>

static double advance(double x, double i) {
    return x * 0.9999997 + i * 0.0000001;
}

static double run(double n) {
    double i = 0.0;
    double x = 1.0;
    while (i < n) {
        x = advance(x, i);
        i += 1.0;
    }
    return x;
}

int main(void) {
    volatile double count = {{COUNT}}.0;
    printf("%.17g\n", run(count));
    return 0;
}
