# Core language benchmark

100 compile runs, 10 fresh-process runs, and 1000 raw runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Process warmups: 1. Raw runtime warmups: 50.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 251.436 ± 53.697 | 92.011 ± 35.006 | 224.358 ± 65.961 | 235.745 ± 58.824 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 105.611 ± 24.370 | 80.758 ± 23.509 | 229.913 ± 61.176 | 231.942 ± 69.593 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 119.324 ± 17.176 | 104.490 ± 35.616 | 300.123 ± 108.588 | 374.572 ± 174.286 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 15.158 ± 7.052 | 20.384 ± 12.051 | 22.361 ± 15.957 | 22.851 ± 14.674 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 37.646 ± 22.160 | 31.202 ± 18.672 | 31.023 ± 19.425 | 25.389 ± 12.992 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 6.127 ± 2.086 | 5.155 ± 1.141 | 5.064 ± 0.812 | 5.618 ± 1.155 |

## VKF internal compiler-core time, including optimizer (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 245.981 ± 53.063 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 101.077 ± 23.310 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 113.818 ± 15.605 |

## VKF empirical optimizer time within compilation (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | large | 500 | 131.763 ± 18.273 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | large | 9 | 94.902 ± 21.019 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | large | 50000 | 91.456 ± 7.812 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | large | 500 | 8.193 ± 2.641 | 10.982 ± 4.479 | 12.159 ± 6.738 | 10.895 ± 3.965 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | large | 9 | 21.945 ± 6.307 | 17.911 ± 6.565 | 19.020 ± 6.727 | 17.536 ± 8.108 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | large | 50000 | 3.258 ± 1.541 | 2.500 ± 1.215 | 2.710 ± 1.097 | 3.362 ± 1.536 |
