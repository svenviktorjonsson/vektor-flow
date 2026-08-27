# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.100 ± 0.013 ms | 1.213 | 0.933 | 0.835 |
| least-squares-tall-96x48 | 0.055 ± 0.004 ms | 0.703 | 0.426 | 0.511 |
| lu-general-96 | 0.124 ± 0.010 ms | 1.621 | 2.106 | 1.994 |
| qr-tall-96x48 | 0.070 ± 0.009 ms | 0.388 | 0.343 | 0.577 |
| cholesky-spd-96 | 0.061 ± 0.013 ms | 1.150 | 1.699 | 1.792 |
| svd-tall-96x48 | 0.238 ± 0.021 ms | 0.295 | 0.528 | 0.535 |
| eigen-symmetric-96 | 0.836 ± 0.118 ms | 1.058 | 1.066 | 1.209 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
