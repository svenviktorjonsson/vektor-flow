# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.096 ± 0.006 ms | 1.193 | 0.978 | 0.804 |
| least-squares-tall-96x48 | 0.053 ± 0.003 ms | 0.699 | 0.407 | 0.536 |
| lu-general-96 | 0.076 ± 0.006 ms | 1.044 | 1.227 | 1.256 |
| qr-tall-96x48 | 0.069 ± 0.008 ms | 0.453 | 0.324 | 0.604 |
| cholesky-spd-96 | 0.042 ± 0.007 ms | 1.039 | 1.432 | 1.247 |
| svd-tall-96x48 | 0.238 ± 0.014 ms | 0.307 | 0.547 | 0.563 |
| eigen-symmetric-96 | 0.941 ± 0.380 ms | 1.143 | 1.242 | 1.367 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
