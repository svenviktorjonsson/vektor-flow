# Core language benchmark

100 compile runs, 10 fresh-process runs, and 1000 raw runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Process warmups: 1. Raw runtime warmups: 50.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 247.419 ± 2.080 | 184.148 ± 1.802 | 87.895 ± 3.068 | 176.892 ± 2.270 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 81.572 ± 0.380 | 85.216 ± 2.272 | 85.802 ± 0.805 | 174.012 ± 2.991 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 47.083 ± 0.793 | 105.737 ± 1.157 | 95.479 ± 1.184 | 173.049 ± 2.389 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 8.254 ± 0.105 | 16.041 ± 0.327 | 16.293 ± 0.136 | 16.137 ± 0.128 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 34.416 ± 0.933 | 22.051 ± 0.225 | 19.568 ± 0.242 | 21.279 ± 0.129 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 5.919 ± 0.092 | 4.793 ± 0.105 | 3.944 ± 0.093 | 5.795 ± 0.089 |

## VKF internal compiler-core time, including optimizer (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 242.636 ± 2.024 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 77.939 ± 0.298 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 43.301 ± 0.488 |

## VKF empirical optimizer time within compilation (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 80.785 ± 0.814 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 71.822 ± 0.131 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 22.298 ± 0.208 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 6.460 ± 0.134 | 14.220 ± 0.049 | 14.282 ± 0.062 | 14.340 ± 0.186 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 31.508 ± 0.396 | 19.440 ± 0.325 | 16.653 ± 0.136 | 18.830 ± 0.442 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 4.247 ± 0.052 | 3.103 ± 0.073 | 2.195 ± 0.013 | 4.075 ± 0.070 |
