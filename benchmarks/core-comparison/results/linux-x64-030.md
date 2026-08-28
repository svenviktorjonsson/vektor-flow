# Core language benchmark

100 compile runs, 10 fresh-process runs, and 1000 raw runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Process warmups: 1. Raw runtime warmups: 50.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 301.070 ± 3.335 | 193.369 ± 2.743 | 95.985 ± 2.153 | 180.622 ± 2.594 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 110.235 ± 1.833 | 90.579 ± 2.473 | 91.539 ± 3.058 | 170.956 ± 4.602 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 123.769 ± 1.715 | 115.151 ± 4.200 | 106.018 ± 4.570 | 178.285 ± 3.703 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 6.401 ± 0.065 | 17.858 ± 0.089 | 18.788 ± 0.150 | 18.544 ± 0.171 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 24.591 ± 0.151 | 25.953 ± 0.221 | 22.443 ± 0.412 | 25.233 ± 0.133 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 5.265 ± 0.120 | 5.207 ± 0.093 | 4.320 ± 0.110 | 6.470 ± 0.125 |

## VKF internal compiler-core time, including optimizer (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 295.706 ± 3.296 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 106.302 ± 1.825 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 118.883 ± 0.943 |

## VKF empirical optimizer time within compilation (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 144.125 ± 0.953 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 99.471 ± 1.816 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 94.624 ± 0.488 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 4.773 ± 0.149 | 16.008 ± 0.167 | 16.798 ± 0.143 | 16.564 ± 0.163 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 22.588 ± 0.174 | 23.339 ± 0.561 | 19.862 ± 0.262 | 22.712 ± 0.232 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 3.448 ± 0.182 | 3.356 ± 0.171 | 2.359 ± 0.016 | 4.584 ± 0.147 |
