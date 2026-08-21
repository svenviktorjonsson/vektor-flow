# Core language benchmark

100 compile runs and 100 runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Runtime warmups: 5.

## Compile time (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 7.367 ± 3.584 |

## Runtime (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 11.767 ± 3.835 |

## VKF raw machine-entry runtime (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| arithmetic + branch | scalar f64 | small | 20000 | 0.413 ± 0.026 |
