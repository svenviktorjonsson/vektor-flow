#include <math.h>
#include <stdio.h>
#ifdef _WIN32
#define BENCH_EXPORT __declspec(dllexport)
#else
#define BENCH_EXPORT __attribute__((visibility("default")))
#endif

typedef struct { double x, y, z, vx, vy, vz, mass; } Body;

static void offset_momentum(Body bodies[5]) {
    double px = 0.0, py = 0.0, pz = 0.0;
    for (int i = 0; i < 5; ++i) {
        px += bodies[i].vx * bodies[i].mass;
        py += bodies[i].vy * bodies[i].mass;
        pz += bodies[i].vz * bodies[i].mass;
    }
    bodies[0].vx = -px / bodies[0].mass;
    bodies[0].vy = -py / bodies[0].mass;
    bodies[0].vz = -pz / bodies[0].mass;
}

static void advance(Body bodies[5], int steps) {
    for (int step = 0; step < steps; ++step) {
        for (int i = 0; i < 5; ++i) {
            for (int j = i + 1; j < 5; ++j) {
                const double dx = bodies[i].x - bodies[j].x;
                const double dy = bodies[i].y - bodies[j].y;
                const double dz = bodies[i].z - bodies[j].z;
                const double squared = dx * dx + dy * dy + dz * dz;
                const double magnitude = 0.01 / (squared * sqrt(squared));
                bodies[i].vx -= dx * bodies[j].mass * magnitude;
                bodies[i].vy -= dy * bodies[j].mass * magnitude;
                bodies[i].vz -= dz * bodies[j].mass * magnitude;
                bodies[j].vx += dx * bodies[i].mass * magnitude;
                bodies[j].vy += dy * bodies[i].mass * magnitude;
                bodies[j].vz += dz * bodies[i].mass * magnitude;
            }
        }
        for (int i = 0; i < 5; ++i) {
            bodies[i].x += 0.01 * bodies[i].vx;
            bodies[i].y += 0.01 * bodies[i].vy;
            bodies[i].z += 0.01 * bodies[i].vz;
        }
    }
}

static double energy(const Body bodies[5]) {
    double result = 0.0;
    for (int i = 0; i < 5; ++i) {
        result += 0.5 * bodies[i].mass *
            (bodies[i].vx * bodies[i].vx + bodies[i].vy * bodies[i].vy + bodies[i].vz * bodies[i].vz);
        for (int j = i + 1; j < 5; ++j) {
            const double dx = bodies[i].x - bodies[j].x;
            const double dy = bodies[i].y - bodies[j].y;
            const double dz = bodies[i].z - bodies[j].z;
            result -= bodies[i].mass * bodies[j].mass / sqrt(dx * dx + dy * dy + dz * dz);
        }
    }
    return result;
}

BENCH_EXPORT double vkf_benchmark(void) {
    const double solar = 39.478417604357434, days = 365.24;
    Body bodies[5] = {
        {0, 0, 0, 0, 0, 0, solar},
        {4.841431442464721, -1.1603200440274284, -0.10362204447112311, 0.001660076642744037*days, 0.007699011184197404*days, -0.0000690460016972063*days, 0.0009547919384243266*solar},
        {8.34336671824458, 4.124798564124305, -0.4035234171143214, -0.002767425107268624*days, 0.004998528012349172*days, 0.000023041729757376393*days, 0.0002858859806661308*solar},
        {12.894369562139131, -15.111151401698631, -0.22330757889265573, 0.002964601375647616*days, 0.0023784717395948095*days, -0.000029658956854023756*days, 0.00004366244043351563*solar},
        {15.379697114850917, -25.919314609987964, 0.17925877295037118, 0.0026806777249038932*days, 0.001628241700382423*days, -0.00009515922545197159*days, 0.000051513890204661146*solar}
    };
    offset_momentum(bodies);
    advance(bodies, 1000);
    return energy(bodies);
}

int main(void) {
    printf("%.17g\n", vkf_benchmark());
    return 0;
}
