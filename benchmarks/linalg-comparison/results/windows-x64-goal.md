# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.107 ± 0.023 ms | 1.096 | 0.917 | 0.835 |
| least-squares-tall-96x48 | 0.208 ± 0.013 ms | 2.493 | 1.582 | 2.041 |
| lu-general-96 | 0.129 ± 0.006 ms | 1.788 | 1.986 | 2.196 |
| qr-tall-96x48 | 0.064 ± 0.004 ms | 0.435 | 0.345 | 0.556 |
| cholesky-spd-96 | 0.065 ± 0.007 ms | 1.443 | 2.439 | 1.914 |
| svd-tall-96x48 | 0.242 ± 0.016 ms | 0.309 | 0.521 | 0.553 |
| eigen-symmetric-96 | 1.012 ± 0.435 ms | 1.193 | 1.201 | 1.501 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
