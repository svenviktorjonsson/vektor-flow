import numpy as np


matrix = np.array([
    [1.0, 0.0, 1.0, 0.0],
    [0.0, 1.0, 0.0, 1.0],
    [0.0, 0.000001, 0.999999, 0.0],
    [-0.000001, 0.0, 0.0, 0.999998],
], dtype=np.float64)
state = np.array([1.0, 2.0, 0.01, 0.02], dtype=np.float64)
result = np.linalg.matrix_power(matrix, {{COUNT}}) @ state
print(format(float(np.sum(result)), '.17g'))
