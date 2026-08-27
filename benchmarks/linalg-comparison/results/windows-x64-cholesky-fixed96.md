# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| cholesky-spd-96 | 0.038 ± 0.002 ms | 0.873 | 1.493 | 1.190 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
