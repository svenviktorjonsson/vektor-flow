# Core language benchmark

100 compile runs, 10 fresh-process runs, and 1000 raw runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Process warmups: 1. Raw runtime warmups: 50.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 299.616 ± 1.467 | 188.107 ± 0.748 | 92.633 ± 0.392 | 178.601 ± 2.802 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 109.532 ± 0.210 | 86.274 ± 0.536 | 88.085 ± 0.725 | 166.242 ± 1.770 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 122.085 ± 0.394 | 109.389 ± 0.519 | 101.279 ± 0.940 | 174.892 ± 1.907 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 6.379 ± 0.078 | 17.766 ± 0.075 | 18.644 ± 0.088 | 18.481 ± 0.222 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 24.347 ± 0.048 | 25.765 ± 0.132 | 22.202 ± 0.157 | 24.929 ± 0.105 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 5.289 ± 0.110 | 5.161 ± 0.135 | 4.266 ± 0.111 | 6.372 ± 0.048 |

## VKF internal compiler-core time, including optimizer (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 294.495 ± 1.448 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 105.750 ± 0.193 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 117.505 ± 0.320 |

## VKF empirical optimizer time within compilation (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 144.216 ± 0.423 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 99.142 ± 0.182 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 93.901 ± 0.295 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 4.756 ± 0.126 | 15.995 ± 0.018 | 16.814 ± 0.130 | 16.643 ± 0.173 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 22.580 ± 0.122 | 23.360 ± 0.575 | 19.907 ± 0.533 | 22.703 ± 0.145 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 3.507 ± 0.114 | 3.354 ± 0.172 | 2.356 ± 0.020 | 4.559 ± 0.066 |
