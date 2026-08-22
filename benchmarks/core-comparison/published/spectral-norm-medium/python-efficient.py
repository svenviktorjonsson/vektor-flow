import numpy as np

n = 250
row = np.arange(n, dtype=np.int64)[:, None]
column = np.arange(n, dtype=np.int64)[None, :]
diagonal = row + column
a = 1.0 / (diagonal * (diagonal + 1) // 2 + row + 1)
u = np.ones(n, dtype=np.float64)
v = np.zeros(n, dtype=np.float64)
for _ in range(10):
    v = a.T @ (a @ u)
    u = a.T @ (a @ v)
print(format(float(np.sqrt(np.dot(u, v) / np.dot(v, v))), '.17g'))
