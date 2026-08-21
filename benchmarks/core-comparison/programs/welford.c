#include <math.h>
#include <stdio.h>

typedef struct {
    double count;
    double mean;
    double m2;
} State;

static State welford_step(State state, double value) {
    const double count = state.count + 1.0;
    const double delta = value - state.mean;
    const double mean = state.mean + delta / count;
    const double delta2 = value - mean;
    const State next = {count, mean, state.m2 + delta * delta2};
    return next;
}

static double population_stddev(const volatile double *data, int length) {
    State state = {0.0, 0.0, 0.0};
    for (int index = 0; index < length; ++index) {
        state = welford_step(state, data[index]);
    }
    return sqrt(state.m2 / state.count);
}

int main(void) {
    volatile double values[] = { {{VALUES}} };
    printf("%.17g\n", population_stddev(values, {{COUNT}}));
    return 0;
}
