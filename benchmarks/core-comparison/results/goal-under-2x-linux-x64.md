# Core language benchmark

3 compile runs and 100 runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Runtime warmups: 10.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 106.893 ± 22.149 | 178.427 ± 28.246 | 561.849 ± 164.934 | 472.603 ± 51.573 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 16.437 ± 2.641 | 260.984 ± 100.322 | 565.436 ± 41.984 | 491.572 ± 128.780 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 46.091 ± 12.742 | 243.068 ± 45.706 | 501.581 ± 49.384 | 451.898 ± 53.624 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 27.949 ± 7.764 | 12.816 ± 2.762 | 13.790 ± 3.645 | 12.782 ± 2.898 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 11.077 ± 3.525 | 9.483 ± 3.182 | 9.310 ± 2.724 | 9.337 ± 2.640 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 8.523 ± 4.060 | 6.446 ± 2.259 | 6.865 ± 2.592 | 7.039 ± 2.426 |

## VKF internal compiler-core time (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | medium | 250 | 116.858 ± 34.171 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | medium | 8 | 7.428 ± 0.968 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | medium | 10000 | 30.388 ± 2.688 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 8.458 ± 3.487 | 5.401 ± 0.854 | 7.201 ± 1.524 | 6.910 ± 1.616 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 8.351 ± 2.811 | 4.736 ± 0.747 | 4.478 ± 0.956 | 4.195 ± 1.015 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 1.968 ± 0.677 | 1.246 ± 0.292 | 1.180 ± 0.374 | 1.369 ± 0.365 |
