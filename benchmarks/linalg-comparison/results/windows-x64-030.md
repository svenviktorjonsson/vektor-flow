# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64
Samples: 100; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.108 ± 0.037 ms | 1.109 | 0.890 | 0.793 |
| least-squares-tall-96x48 | 0.069 ± 0.059 ms | 0.835 | 0.453 | 0.548 |
| lu-general-96 | 0.088 ± 0.021 ms | 1.051 | 1.192 | 1.377 |
| qr-tall-96x48 | 0.068 ± 0.022 ms | 0.372 | 0.324 | 0.429 |
| cholesky-spd-96 | 0.039 ± 0.011 ms | 0.771 | 1.197 | 0.990 |
| svd-tall-96x48 | 0.249 ± 0.076 ms | 0.276 | 0.461 | 0.459 |
| eigen-symmetric-96 | 0.968 ± 0.366 ms | 0.914 | 0.998 | 1.177 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
