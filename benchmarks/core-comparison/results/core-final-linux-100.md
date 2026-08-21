# Core language benchmark

100 compile runs and 100 runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Runtime warmups: 5.

## Compile time (ms)

| operation | data | size | count | VKF | C | C++ | Rust |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 11.498 ± 3.203 | 173.378 ± 35.344 | 255.357 ± 52.167 | 502.149 ± 94.789 |
| linear recurrence | vector[4] f64 | medium | 75000 | 10.392 ± 2.261 | 177.573 ± 44.427 | 255.266 ± 49.834 | 540.270 ± 105.322 |
| Welford population standard deviation | dynamic container f64 | large | 6400 | 202.735 ± 43.550 | 223.978 ± 43.200 | 645.302 ± 101.215 | 12929.038 ± 2231.702 |

## Runtime (ms)

| operation | data | size | count | VKF | C | C++ | Rust |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 5.666 ± 1.486 | 6.166 ± 1.467 | 7.236 ± 1.989 | 4.896 ± 1.110 |
| linear recurrence | vector[4] f64 | medium | 75000 | 7.828 ± 1.855 | 5.354 ± 1.531 | 6.522 ± 1.477 | 6.837 ± 1.974 |
| Welford population standard deviation | dynamic container f64 | large | 6400 | 3.920 ± 0.753 | 3.596 ± 0.704 | 4.649 ± 0.887 | 3.553 ± 0.818 |

## VKF raw machine-entry runtime (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 0.964 ± 0.239 |
| linear recurrence | vector[4] f64 | medium | 75000 | 3.736 ± 1.473 |
| Welford population standard deviation | dynamic container f64 | large | 6400 | 0.454 ± 0.145 |
