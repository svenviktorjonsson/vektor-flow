#include <stdio.h>

typedef struct { double x, y, vx, vy; } State;

static State advance(State state) {
    return (State) {
        state.x + state.vx,
        state.y + state.vy,
        state.vx * 0.999999 + state.y * 0.000001,
        state.vy * 0.999998 - state.x * 0.000001
    };
}

static double run(double n) {
    double i = 0.0;
    State state = {1.0, 2.0, 0.01, 0.02};
    while (i < n) {
        state = advance(state);
        i += 1.0;
    }
    return state.x + state.y + state.vx + state.vy;
}

int main(void) {
    volatile double count = {{COUNT}}.0;
    printf("%.17g\n", run(count));
    return 0;
}
