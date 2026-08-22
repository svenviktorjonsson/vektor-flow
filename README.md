# Vektor Flow

**Designed by Viktor Jonsson.**

**VKF automatically applies ordinary typed functions across compatible parts of structured data while preserving shape and metadata.**

Vektor Flow (VKF) is an experimental language for compact native programs,
structured data, mathematics, and eventually visual applications.

> [!WARNING]
> VKF 0.1.3 is an unsupported experimental preview. It has bugs, incomplete
> diagnostics, and unstable APIs and syntax. Do not use it for production or
> run untrusted VKF programs.
>
> The intended visual system is not native yet. `ui`, `physics`, and `symbolic`
> are deliberately absent from this release rather than using compatibility
> fallbacks.

## Why VKF Is Different

### Ordinary Functions Apply Structurally

<!-- readme-example: core/25-structural-compatibility.vkf -->
```vkf
double(value:int) -> int:
    value * 2

point: (name:"origin", enabled:true, x:2, y:3)
result: double(point)

:: result
```

<!-- readme-evidence:start core/25-structural-compatibility.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
(name:origin, enabled:true, x:4, y:6)
```

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 1.716 ± 0.131 ms | 0.586 ± 0.016 ms | 0.854 ± 0.088 ms |
| Runtime | 15.297 ± 1.760 ms | 1.861 ± 0.056 ms | 1.768 ± 0.693 ms |

<!-- readme-evidence:end -->

`double` accepts `int`, so VKF recursively transforms `x` and `y`. The
incompatible `str` and `bit` metadata remains unchanged. This is a general
language rule—not a special feature of `math` or `+`.

This convenience can also surprise: incompatible fields are intentionally
preserved instead of producing an error. Use a container-typed parameter when
the whole container must match exactly. The [language guide](docs/language-guide.md#4-automatic-element-wise-function-application)
defines the compatibility rules.

### Named Axes Express Tensor Intent

<!-- readme-example: core/42-axes.vkf -->
```vkf
matrix: [1, 2, 3]->i * [1, 2, 3]->j
diagonal: [1, 2, 3]->i * [4, 5, 6]->i
tensor: [1, 2]->i * [3, 4]->j * [5, 6]->k

:: matrix
:: diagonal
:: tensor
```

<!-- readme-evidence:start core/42-axes.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[[1, 2, 3], [2, 4, 6], [3, 6, 9]]
[4, 10, 18]
[[[15, 18], [20, 24]], [[30, 36], [40, 48]]]
```

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.305 ± 0.107 ms | 0.943 ± 0.016 ms | 1.031 ± 0.099 ms |
| Runtime | 14.495 ± 0.553 ms | 1.947 ± 0.067 ms | 2.081 ± 0.744 ms |

<!-- readme-evidence:end -->

Matching axes compute element-wise. Distinct axes form outer products, and
additional distinct axes preserve tensor rank.

## Install VKF 0.1.3

Download the [0.1.3 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.3).

| Platform | Recommended download | Installation |
| --- | --- | --- |
| Windows x64 | `vektor-flow-windows-x64-setup.exe` | Run it; optionally add VKF to `PATH`. |
| Linux x64 (Debian/Ubuntu) | `vektor-flow-linux-x64.deb` | `sudo apt install ./vektor-flow-linux-x64.deb` |
| macOS Apple Silicon | `vektor-flow-macos-arm64.pkg` | Open it and follow the installer. |

Portable `.zip` and `.tar.gz` archives are on the same release page. Linux and
macOS archives include a per-user `install.sh`; do not run it with `sudo`.

Open a new terminal:

```bash
vkf -e ':: "hello, world"'
```

The installed compiler directly emits PE, ELF, or Mach-O executables. Compiling
and running a VKF program requires no Python, C++ compiler, assembler, or
separate linker.

### Commands

| Command | Result |
| --- | --- |
| `vkf program.vkf` | Build beside the source if changed, then run. |
| `vkf program.vkf -o app` | Build or reuse the named executable, then run. |
| `vkf -b program.vkf` | Build only. |
| `vkf -b program.vkf -o app` | Build only with an explicit output name. |
| `vkf -e ':: 2 + 2'` | Evaluate inline source. |
| `vkf -t tests.vkf` | Run native tests in a file or directory. |
| `vkf -v` | Print the compiler release version. |

`-b` is build, `-e` is evaluate, `-t` is test, `-v` is version, and `-o` names the executable.
Passing a `.vkf` file is the run command; there is no `-r`. A fingerprint of
source, imports, target, compiler, and output choice allows unchanged programs
to reuse their executable.

## Performance Evidence—And Its Limits

The 0.1.3 release compiles every documented program 100 times from fresh paths
and executes it 100 times in fresh operating-system processes on Windows x64,
Linux x64, and macOS ARM64. Reports record every sample, exact output, source
hash, compiler hash, and machine conditions. The 10-million-operation container
case keeps its workload fixed even when timings change.

<!-- readme-platform-evidence:start -->
| Detail | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Measured UTC | `2026-08-22T10:04:32.353Z` | `2026-08-22T10:03:31.358Z` | `2026-08-22T10:01:58.498Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | INTEL(R) XEON(R) PLATINUM 8573C | AMD EPYC 7763 64-Core Processor | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 3,677,184 bytes | 4,754,240 bytes | 2,169,272 bytes |
| Compiler SHA-256 | `5a588e22975536b5ef6fae53620316889ed4cf3b9e1fe0c77776a3eabcbd6f0e` | `16c65418f3aedf164cf95c350fab534272e997def536cc87040876729464e68b` | `0daa41d9304ca9182e4bc195b33ff11eb557f5b1454b070cc56784df4e7334bf` |
| Timing host | v22.23.2 `Node performance.now()` | v22.23.2 `Node performance.now()` | v22.23.1 `Node performance.now()` |
<!-- readme-platform-evidence:end -->

These absolute timings prove reproducibility and expose regressions. They do
**not** prove that VKF is generally faster than C, Rust, Zig, Go, Julia, or
Python.

### Reproducible Language Comparison

Rows marked **matched** use the same algorithm. Rows marked **idiomatic** let
each ecosystem use its normal optimized route: NumPy/SciPy for Python and
linear algebra for Julia where appropriate. VKF is the only code displayed;
every other implementation is linked exactly. Tool versions, source hashes,
work counts, output parity, compile models, and 100-run dispersion are retained.

<!-- readme-comparison-evidence:start -->
Measured on `linux 6.17.0-1022-azure`, `x64`, AMD EPYC 7763 64-Core Processor, 4 logical CPUs, at `2026-08-22T10:13:39.518Z`.

Every table cell is mean ± sample standard deviation from 100 measured runs. Fresh-process compile includes tool startup for every language. Julia parses source and JIT-compiles during runtime; Python produces bytecode; native toolchains emit executables. VKF compiler-core time excludes compiler startup and is the separate <10 ms gate. Raw VKF machine-entry time is the separate <500 µs gate.

### Startup and output

Mode: **matched**. print one numeric value.

```vkf
:: 0
```

All implementations returned the same checked numeric result within tolerance: `0`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 2.511 ± 0.059 ms | 0.132 ± 0.012 ms | 1.869 ± 0.129 ms | 0.000 ± 0.000 ms | [source](benchmarks/core-comparison/published/startup/vkf.vkf) |
| C | 59.460 ± 0.551 ms | — | 1.665 ± 0.114 ms | — | [source](benchmarks/core-comparison/published/startup/c.c) |
| Rust | 55.826 ± 0.725 ms | — | 1.746 ± 0.061 ms | — | [source](benchmarks/core-comparison/published/startup/rust.rs) |
| Zig | 146.039 ± 1.732 ms | — | 1.629 ± 0.070 ms | — | [source](benchmarks/core-comparison/published/startup/zig.zig) |
| Go | 83.062 ± 1.897 ms | — | 2.353 ± 0.104 ms | — | [source](benchmarks/core-comparison/published/startup/go.go) |
| Julia | 183.065 ± 1.523 ms | — | 209.920 ± 2.612 ms | — | [source](benchmarks/core-comparison/published/startup/julia.jl) |
| Python | 41.834 ± 0.342 ms | — | 13.736 ± 0.164 ms | — | [source](benchmarks/core-comparison/published/startup/python-efficient.py) |

### arithmetic + branch — small, 20,000 iterations

Mode: **matched**. same scalar loop and branch in every language.

```vkf
advance(x:num, i:num) -> num:
    y: x * 1.00000011920929 + i * 0.0000001
    y > 1000?
        @: y - 999.5
    y

run(n:num) -> num:
    i: 0
    x: 1
    i < n?>
        .x: advance(x, i)
        .i: i + 1
    x

:: run(20000)
```

All implementations returned the same checked numeric result within tolerance: `21.017288693559877`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 3.501 ± 0.118 ms | 0.761 ± 0.019 ms | 2.236 ± 0.110 ms | 0.401 ± 0.006 ms | [source](benchmarks/core-comparison/published/scalar-control-small/vkf.vkf) |
| C | 63.722 ± 0.515 ms | — | 1.798 ± 0.138 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/c.c) |
| Rust | 61.130 ± 0.509 ms | — | 1.860 ± 0.077 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/rust.rs) |
| Zig | 149.915 ± 2.380 ms | — | 1.737 ± 0.064 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/zig.zig) |
| Go | 83.834 ± 2.309 ms | — | 2.427 ± 0.102 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/go.go) |
| Julia | 183.883 ± 2.832 ms | — | 545.368 ± 4.142 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/julia.jl) |
| Python | 42.037 ± 0.344 ms | — | 16.240 ± 0.168 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/python-efficient.py) |

### linear recurrence — medium, 75,000 iterations

Mode: **idiomatic**. native value loops; NumPy and Julia use matrix exponentiation.

```vkf
advance(v:[num:4]) -> [num:4]:
    [
        v.0 * 1.0000001 + v.1 * 0.000001,
        v.1 * 0.9999999 - v.2 * 0.000001,
        v.2 * 1.0000002 + v.3 * 0.000001,
        v.3 * 0.9999998 - v.0 * 0.000001
    ]

run(n:num) -> num:
    i: 0
    v: [1, 2, 3, 4]
    i < n?>
        .v: advance(v)
        .i: i + 1
    v.0 + v.1 + v.2 + v.3

:: run(75000)
```

All implementations returned the same checked numeric result within tolerance: `10.099567298080487`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 4.088 ± 0.091 ms | 1.232 ± 0.020 ms | 3.538 ± 0.111 ms | 1.478 ± 0.006 ms | [source](benchmarks/core-comparison/published/fixed-vector-medium/vkf.vkf) |
| C | 65.118 ± 0.627 ms | — | 2.157 ± 0.117 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/c.c) |
| Rust | 65.701 ± 0.397 ms | — | 2.354 ± 0.085 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/rust.rs) |
| Zig | 150.698 ± 3.039 ms | — | 2.191 ± 0.266 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/zig.zig) |
| Go | 82.989 ± 1.526 ms | — | 2.717 ± 0.123 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/go.go) |
| Julia | 183.832 ± 1.584 ms | — | 1097.008 ± 4.858 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/julia.jl) |
| Python | 42.171 ± 0.451 ms | — | 105.554 ± 0.788 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/python-efficient.py) |

### record update — medium, 75,000 iterations

Mode: **idiomatic**. native record loops; NumPy and Julia use matrix exponentiation.

```vkf
State : (x:num, y:num, vx:num, vy:num)

advance(state:State) -> State:
    (
        x: state.x + state.vx,
        y: state.y + state.vy,
        vx: state.vx * 0.999999 + state.y * 0.000001,
        vy: state.vy * 0.999998 - state.x * 0.000001
    )

run(n:num) -> num:
    i: 0
    state: (x:1, y:2, vx:0.01, vy:0.02)
    i < n?>
        .state: advance(state)
        .i: i + 1
    state.x + state.y + state.vx + state.vy

:: run(75000)
```

All implementations returned the same checked numeric result within tolerance: `-2.0473715203632542e+23`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 4.143 ± 0.140 ms | 1.168 ± 0.019 ms | 3.496 ± 0.149 ms | 1.438 ± 0.025 ms | [source](benchmarks/core-comparison/published/record-value-medium/vkf.vkf) |
| C | 65.086 ± 0.565 ms | — | 1.983 ± 0.121 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/c.c) |
| Rust | 65.297 ± 0.593 ms | — | 2.137 ± 0.094 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/rust.rs) |
| Zig | 150.322 ± 1.942 ms | — | 1.940 ± 0.079 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/zig.zig) |
| Go | 83.398 ± 1.360 ms | — | 2.659 ± 0.116 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/go.go) |
| Julia | 183.387 ± 1.584 ms | — | 1097.656 ± 4.596 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/julia.jl) |
| Python | 42.203 ± 1.061 ms | — | 105.453 ± 0.674 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/python-efficient.py) |

<details>
<summary>Exact toolchains and compile models</summary>

- VKF: `VKF 0.1.2; built with Ubuntu clang version 18.1.3 (1ubuntu1)`; fresh VKF process + Python-free integrated frontend + compiler-owned direct x64 artifact
- C: `Ubuntu clang version 18.1.3 (1ubuntu1)`; Clang -O3 -march=native native link
- Rust: `rustc 1.98.0 (88d9e12ae 2026-08-18)`; rustc -O -C target-cpu=native native link
- Zig: `0.16.0`; zig build-exe -O ReleaseFast -mcpu native -lc
- Go: `go version go1.26.5 linux/amd64`; go build -trimpath -ldflags=-s -w
- Julia: `julia version 1.12.7`; Julia source parse in a fresh process (not native AOT compilation)
- Python: `Python 3.14.7; NumPy 2.5.1; SciPy 1.18.0`; CPython bytecode compile

</details>
<!-- readme-comparison-evidence:end -->

The [comparative benchmark laboratory](benchmarks/core-comparison/README.md)
contains reproduction commands and interpretation limits. Results are narrow
evidence, not a universal speed ranking.

Exact 100-run output and compile/runtime tables for all documented programs are
in the [full language guide](docs/language-guide.md). They are generated only
when all three reports match the current version, compiler hashes, and exact
source hashes.

## Status And Native Scope

The 0.1.3 native release includes `math`, `stat`, `random`, `time`, `io`,
`collections`, `errors`, `system`, `process`, and `regex`. Only fully native,
verified libraries ship. `physics`, `ui`, and `symbolic` remain future work.

The release gate currently contains **298 VKF tests** plus 59 documented-program
checks. Final Windows/Linux/macOS pass counts and timing evidence are inserted
only from the exact tagged release compilers.

## Punctuation At A Glance

| Syntax | Meaning |
| --- | --- |
| `:: value` | Print a value. |
| `::: value` | Print a labelled value. |
| `condition?` / `condition?>` | Conditional / loop while true. |
| `value??` / `value??>` | Match / repeated match. |
| `error!` / `expression!?` | Raise a typed error / catch errors. |
| `@:` / `@` | Return a value / return `null`. |
| `@>` / `@|` | Continue / break. |
| `: .module` | Spill a module into the current scope. |

`!` is never factorial. Only error types and error values may be raised.

## Safety

The compiler refuses to overwrite an unrecognized existing file or a
symbolic-link output. Installers reject unsafe roots, non-VKF installation
folders, and unrelated existing `vkf` commands.

VKF programs still run with the current user's permissions. `io` can modify
files and `process` can launch programs. `process.run` passes an exact argument
vector; `process.shell` invokes a platform shell and must be treated as unsafe.

## 0.1.3 Changes

0.1.3 closes the numeric runtime gaps exposed by the comparison suite:

- aggregate-return numeric helpers now inline into hot loops;
- x64 lowering fuses arithmetic, comparisons, branches, stores, and repeated local loads;
- supported x64 hosts use AVX2/FMA for recognized four-lane affine recurrences;
- the SysV four-field record recurrence stays entirely in registers;
- pure numeric Linux programs launch through a minimal executable shell;
- that shell uses dedicated numeric conversion plus a direct write syscall;
- detected x64 CPU features are included in build fingerprints, preventing unsafe cache reuse;
- two native VKF optimizer regression tests preserve vector and record results.

The fixed workloads and comparison implementations were not changed to obtain
the improvement. See the [0.1.3 release notes](docs/releases/0.1.3.md).

## 0.1.2 Changes

0.1.2 closes these gaps from 0.1.1:

- `name: value` only declares; duplicate declarations in one scope are errors;
- `.name: value` only updates an existing reachable binding;
- compound updates require the dot, such as `.name +: value`;
- declarations and updates are value-returning expressions;
- parameters count as existing declarations and may only be updated with dot syntax;
- structural compound arithmetic updates compatible leaves and preserves incompatible metadata;
- `: .errors` exposes bare error types, `Error!` raises a default error, and ordinary values such as `2!` are rejected;
- `vkf -t` verifies exact expected compile failures as well as successful tests;
- `vkf -v` identifies the embedded compiler release, and proof rejects package/compiler version mismatches;
- every documented program has source-hash-bound exact output and three-platform 100-run timing evidence.

See the [complete release history and packaging contract](RELEASES.md).

## Documentation

- [Full numbered language guide](docs/language-guide.md)
- [Installation and source builds](INSTALL.md)
- [Testing guide](TESTING.md)
- [Release process and artifact contract](RELEASES.md)
- [Issue tracker](https://github.com/svenviktorjonsson/vektor-flow/issues)

## Development History

The language was designed by Viktor Jonsson, and the implementation has been
completely vibe coded. That history is disclosed here rather than presented as
a quality guarantee. Trust should come from readable source, reproducible
tests, exact artifacts and hashes, independent review, and clearly stated
limitations.
