# VKF linear-algebra comparison evidence

Host: `AMD EPYC 7763 64-Core Processor                `, win32-x64
Samples: 100; threads: 1

| Kernel | VKF mean ± std | VKF / eigen | VKF / faer | VKF / scipy |
| --- | ---: | ---: | ---: | ---: |
| solve-general-96 | 0.081 ± 0.010 ms | 0.711 | 0.621 | 0.522 |
| least-squares-tall-96x48 | 0.082 ± 0.010 ms | 0.772 | 0.901 | 0.533 |
| lu-general-96 | 0.063 ± 0.009 ms | 0.579 | 1.149 | 0.900 |
| qr-tall-96x48 | 0.077 ± 0.009 ms | 0.352 | 0.423 | 0.487 |
| cholesky-spd-96 | 0.035 ± 0.008 ms | 0.572 | 1.228 | 0.749 |
| svd-tall-96x48 | 0.262 ± 0.042 ms | 0.242 | 0.432 | 0.474 |
| eigen-symmetric-96 | 0.930 ± 0.113 ms | 0.730 | 0.816 | 1.024 |

Ratios use operation-only time on one host. Every accepted sample passed numerical accuracy gates.
