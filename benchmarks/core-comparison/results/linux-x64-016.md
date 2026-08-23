# Core language benchmark

100 compile runs and 100 runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Runtime warmups: 5.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Python efficient | Rust | Zig | Go | Julia |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| startup | matched | empty process | empty | 0 | 2.864 ± 0.083 | 72.000 ± 0.928 | 47.734 ± 1.136 | 63.847 ± 2.441 | 153.962 ± 2.784 | 89.957 ± 2.085 | 192.223 ± 2.078 |
| compiler regression: arithmetic + branch | engineering-regression | scalar f64; not a comparative language benchmark | regression | 20000 | 4.202 ± 0.172 | N/A | N/A | N/A | N/A | N/A | N/A |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 41.640 ± 0.548 | 183.493 ± 1.560 | 47.848 ± 1.097 | 93.538 ± 0.692 | 183.663 ± 2.505 | 90.172 ± 1.431 | 193.497 ± 4.445 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 7.990 ± 0.205 | 90.875 ± 1.313 | 48.631 ± 1.299 | 89.081 ± 0.727 | 174.265 ± 2.894 | 90.669 ± 4.071 | 192.848 ± 1.951 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 21.105 ± 0.642 | 113.878 ± 2.144 | 48.750 ± 1.124 | 104.486 ± 0.589 | 180.296 ± 3.439 | 90.620 ± 4.494 | 193.448 ± 2.371 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Python efficient | Rust | Zig | Go | Julia |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| startup | matched | empty process | empty | 0 | 2.031 ± 0.124 | 1.918 ± 0.151 | 15.448 ± 0.394 | 2.116 ± 0.094 | 1.872 ± 0.096 | 2.603 ± 0.102 | 221.561 ± 3.077 |
| compiler regression: arithmetic + branch | engineering-regression | scalar f64; not a comparative language benchmark | regression | 20000 | 1.793 ± 0.066 | N/A | N/A | N/A | N/A | N/A | N/A |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 16.470 ± 0.120 | 6.127 ± 0.124 | 110.757 ± 2.512 | 6.523 ± 0.143 | 6.271 ± 0.133 | 6.958 ± 0.142 | 391.650 ± 3.395 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 5.058 ± 0.140 | 4.448 ± 0.167 | 129.433 ± 5.184 | 4.437 ± 0.160 | 4.296 ± 0.151 | 5.088 ± 0.146 | 284.500 ± 4.355 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 4.350 ± 0.143 | 2.680 ± 0.178 | 186.849 ± 5.989 | 2.842 ± 0.225 | 2.938 ± 0.194 | 3.512 ± 0.105 | 1755.892 ± 26.499 |

## VKF internal compiler-core time (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| startup | empty process | empty | 0 | 0.148 ± 0.018 |
| compiler regression: arithmetic + branch | scalar f64; not a comparative language benchmark | regression | 20000 | 0.965 ± 0.023 |
| spectral norm by power method | dense f64 vectors and implicit matrix | medium | 250 | 32.053 ± 1.622 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | medium | 8 | 3.322 ± 0.033 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | medium | 10000 | 11.867 ± 0.117 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Python efficient | Rust | Zig | Go | Julia |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| startup | matched | empty process | empty | 0 | 0.000 ± 0.000 | 0.000 ± 0.000 | N/A | 0.000 ± 0.000 | 0.000 ± 0.000 | N/A | N/A |
| compiler regression: arithmetic + branch | engineering-regression | scalar f64; not a comparative language benchmark | regression | 20000 | 0.106 ± 0.004 | N/A | N/A | N/A | N/A | N/A | N/A |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 13.440 ± 0.047 | 4.000 ± 0.011 | N/A | 4.135 ± 0.032 | 4.161 ± 0.033 | N/A | N/A |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 2.735 ± 0.011 | 2.348 ± 0.008 | N/A | 1.954 ± 0.008 | 2.256 ± 0.010 | N/A | N/A |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 2.075 ± 0.012 | 0.666 ± 0.006 | N/A | 0.469 ± 0.007 | 0.910 ± 0.004 | N/A | N/A |
