#include <stdio.h>

int main(int argc, char **argv) {
    (void) argv;
    double values[{{COUNT}}];
    for (int i = 0; i < {{COUNT}}; ++i) {
        values[i] = (double) (i + argc);
    }
    double sum = 0.0;
    for (int i = 0; i < {{COUNT}}; ++i) {
        sum += values[i];
    }
    printf("%.17g\n", sum + sum / (double) {{COUNT}} + (double) {{COUNT}});
    return 0;
}
