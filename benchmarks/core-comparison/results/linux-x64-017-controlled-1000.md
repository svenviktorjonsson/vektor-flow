# Core language benchmark

3 compile runs and 1000 runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Runtime warmups: 50.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 81.840 ± 17.995 | 155.177 ± 9.187 | 492.054 ± 167.615 | 460.638 ± 62.115 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 15.450 ± 1.437 | 143.965 ± 1.621 | 436.656 ± 61.642 | 384.918 ± 24.372 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 39.205 ± 5.525 | 212.944 ± 9.108 | 486.402 ± 122.743 | 488.201 ± 160.451 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 23.004 ± 6.190 | 10.881 ± 2.608 | 11.326 ± 3.018 | 10.896 ± 2.677 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 10.313 ± 2.866 | 8.594 ± 2.244 | 8.709 ± 2.411 | 8.602 ± 2.245 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 7.253 ± 2.202 | 5.575 ± 1.761 | 5.848 ± 1.632 | 5.950 ± 1.766 |

## VKF internal compiler-core time (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | medium | 250 | 63.170 ± 11.185 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | medium | 8 | 6.333 ± 0.704 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | medium | 10000 | 25.933 ± 2.573 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 5.739 ± 1.763 | 6.349 ± 1.969 | 7.378 ± 2.620 | 6.049 ± 1.769 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 4.920 ± 1.309 | 4.141 ± 1.268 | 3.790 ± 1.217 | 3.615 ± 1.057 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 1.898 ± 0.763 | 1.257 ± 0.421 | 0.969 ± 0.226 | 1.236 ± 0.347 |
