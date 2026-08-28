# VKF linear-algebra comparison evidence

Host: `AMD EPYC 7763 64-Core Processor                `, win32-x64
Samples: 100; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.081 ± 0.011 ms | 0.736 | 0.613 | 0.536 |
| least-squares-tall-96x48 | 0.081 ± 0.007 ms | 0.764 | 0.804 | 0.502 |
| lu-general-96 | 0.082 ± 0.010 ms | 0.689 | 1.018 | 1.035 |
| qr-tall-96x48 | 0.088 ± 0.019 ms | 0.367 | 0.400 | 0.540 |
| cholesky-spd-96 | 0.037 ± 0.004 ms | 0.586 | 1.179 | 0.781 |
| svd-tall-96x48 | 0.258 ± 0.032 ms | 0.242 | 0.477 | 0.469 |
| eigen-symmetric-96 | 0.907 ± 0.021 ms | 0.799 | 0.920 | 1.018 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
