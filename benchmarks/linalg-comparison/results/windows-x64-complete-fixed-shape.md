# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.096 ± 0.004 ms | 1.130 | 0.972 | 0.773 |
| least-squares-tall-96x48 | 0.053 ± 0.004 ms | 0.664 | 0.406 | 0.529 |
| lu-general-96 | 0.087 ± 0.039 ms | 1.154 | 1.324 | 1.442 |
| qr-tall-96x48 | 0.068 ± 0.011 ms | 0.376 | 0.372 | 0.568 |
| cholesky-spd-96 | 0.071 ± 0.046 ms | 1.422 | 2.245 | 2.186 |
| svd-tall-96x48 | 0.240 ± 0.029 ms | 0.298 | 0.476 | 0.544 |
| eigen-symmetric-96 | 0.846 ± 0.131 ms | 1.047 | 1.042 | 1.189 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
