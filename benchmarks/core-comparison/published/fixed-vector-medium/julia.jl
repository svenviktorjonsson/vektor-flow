using LinearAlgebra
using Printf

matrix = [
    1.0000001  0.000001   0.0        0.0;
    0.0        0.9999999 -0.000001   0.0;
    0.0        0.0        1.0000002  0.000001;
   -0.000001   0.0        0.0        0.9999998
]
vector = [1.0, 2.0, 3.0, 4.0]
result = matrix ^ 75000 * vector
@printf("%.17g\n", sum(result))
