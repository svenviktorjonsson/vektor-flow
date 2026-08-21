#include <stdio.h>

static double advance(double x, double i) {
    double y = x * 1.00000011920929 + i * 0.0000001;
    return y > 1000.0 ? y - 999.5 : y;
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
