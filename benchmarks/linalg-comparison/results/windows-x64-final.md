# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.097 ± 0.013 ms | 1.231 | 0.962 | 0.784 |
| least-squares-tall-96x48 | 0.056 ± 0.008 ms | 0.615 | 0.459 | 0.525 |
| lu-general-96 | 0.127 ± 0.019 ms | 1.356 | 2.212 | 2.125 |
| qr-tall-96x48 | 0.095 ± 0.094 ms | 0.614 | 0.525 | 0.754 |
| cholesky-spd-96 | 0.053 ± 0.011 ms | 1.268 | 1.980 | 1.658 |
| svd-tall-96x48 | 0.319 ± 0.255 ms | 0.417 | 0.727 | 0.695 |
| eigen-symmetric-96 | 0.832 ± 0.096 ms | 1.038 | 1.050 | 1.193 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
