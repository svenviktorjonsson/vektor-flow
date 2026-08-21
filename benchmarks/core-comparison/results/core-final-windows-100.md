# Core language benchmark

100 compile runs and 100 runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Runtime warmups: 5.

## Compile time (ms)

| operation | data | size | count | VKF | C | C++ | Rust |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 78.849 ± 17.717 | 502.170 ± 94.354 | 416.067 ± 67.515 | 520.180 ± 82.774 |
| linear recurrence | vector[4] f64 | medium | 75000 | 86.069 ± 25.039 | 484.852 ± 68.990 | 429.657 ± 101.049 | 560.625 ± 95.971 |
| Welford population standard deviation | dynamic container f64 | large | 6400 | 676.698 ± 77.115 | 521.146 ± 115.747 | 477.503 ± 84.368 | 5538.019 ± 595.003 |

## Runtime (ms)

| operation | data | size | count | VKF | C | C++ | Rust |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 17.851 ± 5.493 | 19.132 ± 6.334 | 19.180 ± 6.791 | 20.602 ± 6.709 |
| linear recurrence | vector[4] f64 | medium | 75000 | 21.161 ± 6.642 | 23.402 ± 20.217 | 21.331 ± 7.410 | 22.244 ± 6.749 |
| Welford population standard deviation | dynamic container f64 | large | 6400 | 18.983 ± 7.810 | 18.561 ± 6.330 | 19.302 ± 7.346 | 19.880 ± 7.053 |

## VKF raw machine-entry runtime (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 0.700 ± 0.156 |
| linear recurrence | vector[4] f64 | medium | 75000 | 2.721 ± 1.192 |
| Welford population standard deviation | dynamic container f64 | large | 6400 | 0.416 ± 0.130 |
