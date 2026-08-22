using LinearAlgebra
using Printf

matrix = [
    1.0        0.0       1.0       0.0;
    0.0        1.0       0.0       1.0;
    0.0        0.000001  0.999999  0.0;
   -0.000001   0.0       0.0       0.999998
]
state = [1.0, 2.0, 0.01, 0.02]
result = matrix ^ 75000 * state
@printf("%.17g\n", sum(result))
