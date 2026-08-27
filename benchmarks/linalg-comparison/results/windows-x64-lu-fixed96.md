# VKF linear-algebra comparison evidence

Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 10; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| lu-general-96 | 0.074 ± 0.004 ms | 0.784 | 1.364 | 1.137 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
