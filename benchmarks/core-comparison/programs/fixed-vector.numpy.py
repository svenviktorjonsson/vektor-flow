import numpy as np


matrix = np.array([
    [1.0000001, 0.000001, 0.0, 0.0],
    [0.0, 0.9999999, -0.000001, 0.0],
    [0.0, 0.0, 1.0000002, 0.000001],
    [-0.000001, 0.0, 0.0, 0.9999998],
], dtype=np.float64)
vector = np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float64)
result = np.linalg.matrix_power(matrix, {{COUNT}}) @ vector
print(format(float(np.sum(result)), '.17g'))
