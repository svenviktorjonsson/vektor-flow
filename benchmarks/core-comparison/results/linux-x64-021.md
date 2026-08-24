# Core language benchmark

100 compile runs, 10 fresh-process runs, and 1000 raw runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Process warmups: 1. Raw runtime warmups: 50.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 321.500 ± 1.842 | 190.418 ± 3.474 | 94.694 ± 1.864 | 180.096 ± 2.590 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 92.407 ± 0.528 | 89.196 ± 2.816 | 90.199 ± 0.854 | 170.025 ± 2.780 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 122.855 ± 1.062 | 111.570 ± 0.740 | 103.236 ± 0.664 | 176.750 ± 2.573 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 6.559 ± 0.124 | 17.872 ± 0.095 | 18.729 ± 0.183 | 18.581 ± 0.111 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 27.323 ± 2.296 | 26.542 ± 1.688 | 22.221 ± 0.112 | 25.586 ± 1.307 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 6.379 ± 0.159 | 5.205 ± 0.088 | 4.306 ± 0.044 | 6.563 ± 0.252 |

## VKF internal compiler-core time, including optimizer (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 316.172 ± 1.815 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 88.513 ± 0.505 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 118.127 ± 1.019 |

## VKF empirical optimizer time within compilation (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 151.788 ± 0.507 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 82.157 ± 0.488 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 95.685 ± 0.987 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 4.719 ± 0.125 | 16.006 ± 0.139 | 16.826 ± 0.128 | 16.615 ± 0.198 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 24.131 ± 0.301 | 23.321 ± 0.372 | 19.837 ± 0.237 | 22.699 ± 0.183 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 4.488 ± 0.261 | 3.359 ± 0.206 | 2.358 ± 0.046 | 4.562 ± 0.086 |
