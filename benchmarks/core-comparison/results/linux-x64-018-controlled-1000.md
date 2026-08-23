# Core language benchmark

3 compile runs and 1000 runtime runs. Values shown as mean ± sample standard deviation in ms. Compile warmups: 1. Runtime warmups: 50.

Matched rows keep the same algorithm. Idiomatic rows allow each ecosystem's normal optimized implementation; inspect the linked source before comparing them.

## Compile time (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 85.890 ± 15.808 | 259.813 ± 105.746 | 374.144 ± 10.954 | 469.190 ± 94.736 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 28.612 ± 2.756 | 134.400 ± 3.260 | 416.974 ± 36.618 | 436.042 ± 86.834 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 34.677 ± 1.073 | 165.693 ± 5.173 | 498.737 ± 181.377 | 426.033 ± 65.314 |

## Runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 22.762 ± 6.564 | 10.827 ± 3.085 | 11.275 ± 3.538 | 10.761 ± 3.159 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 11.205 ± 3.420 | 8.070 ± 2.350 | 8.253 ± 2.467 | 8.122 ± 2.443 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 7.471 ± 3.622 | 6.164 ± 2.733 | 6.464 ± 2.817 | 6.580 ± 2.796 |

## VKF internal compiler-core time (ms)

| operation | data | size | count | VKF |
| --- | --- | --- | ---: | ---: |
| spectral norm by power method | dense f64 vectors and implicit matrix | medium | 250 | 53.182 ± 7.350 |
| fannkuch-redux permutations | fixed integer sequence and indexed mutation | medium | 8 | 10.534 ± 2.601 |
| five-body symplectic integration | five bodies with f64 position, velocity, and mass | medium | 10000 | 27.119 ± 5.045 |

## Raw kernel runtime (ms)

| operation | mode | data | size | count | VKF | C | Rust | Zig |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| spectral norm by power method | idiomatic | dense f64 vectors and implicit matrix | medium | 250 | 5.593 ± 1.565 | 5.663 ± 1.506 | 6.296 ± 2.424 | 5.804 ± 1.997 |
| fannkuch-redux permutations | matched | fixed integer sequence and indexed mutation | medium | 8 | 6.389 ± 2.135 | 3.773 ± 1.082 | 3.455 ± 1.007 | 4.516 ± 1.612 |
| five-body symplectic integration | matched | five bodies with f64 position, velocity, and mass | medium | 10000 | 1.426 ± 0.515 | 1.082 ± 0.578 | 0.948 ± 0.191 | 1.456 ± 0.655 |
