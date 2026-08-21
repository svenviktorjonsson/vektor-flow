#include <stdio.h>

typedef struct { double x0, x1, x2, x3; } Vector4;

static Vector4 advance(Vector4 v) {
    return (Vector4) {
        v.x0 * 1.0000001 + v.x1 * 0.000001,
        v.x1 * 0.9999999 - v.x2 * 0.000001,
        v.x2 * 1.0000002 + v.x3 * 0.000001,
        v.x3 * 0.9999998 - v.x0 * 0.000001
    };
}

static double run(double n) {
    double i = 0.0;
    Vector4 v = {1.0, 2.0, 3.0, 4.0};
    while (i < n) {
        v = advance(v);
        i += 1.0;
    }
    return v.x0 + v.x1 + v.x2 + v.x3;
}

int main(void) {
    volatile double count = {{COUNT}}.0;
    printf("%.17g\n", run(count));
    return 0;
}
