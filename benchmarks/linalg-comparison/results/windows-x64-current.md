# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 7.949 ± 0.907 ms | 86.030 | 54.365 | 56.020 |
| least-squares-tall-96x48 | 4.443 ± 0.452 ms | 54.273 | 33.081 | 40.774 |
| lu-general-96 | 7.856 ± 0.612 ms | 96.917 | 140.664 | 124.898 |
| qr-tall-96x48 | 3.559 ± 0.400 ms | 21.816 | 19.153 | 29.545 |
| cholesky-spd-96 | 7.200 ± 2.310 ms | 139.773 | 182.687 | 210.888 |
| svd-tall-96x48 | 48.963 ± 5.063 ms | 61.497 | 112.810 | 112.610 |
| eigen-symmetric-96 | 247.588 ± 31.176 ms | 322.598 | 332.114 | 380.050 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
