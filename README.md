# Vektor Flow

**Designed by Viktor Jonsson.**

**VKF automatically applies ordinary typed functions across compatible parts of structured data while preserving shape and metadata.**

Vektor Flow (VKF) is an experimental language for compact native programs,
structured data, mathematics, and eventually visual applications.

> [!WARNING]
> VKF 0.1.2 is an unsupported experimental preview. It has bugs, incomplete
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
| Compile | 2.477 ± 1.238 ms | 0.580 ± 0.040 ms | 0.829 ± 0.104 ms |
| Runtime | 17.724 ± 1.403 ms | 1.865 ± 0.051 ms | 1.521 ± 0.115 ms |

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
| Compile | 3.025 ± 0.333 ms | 0.934 ± 0.014 ms | 1.000 ± 0.167 ms |
| Runtime | 17.326 ± 0.996 ms | 1.948 ± 0.066 ms | 1.521 ± 0.099 ms |

<!-- readme-evidence:end -->

Matching axes compute element-wise. Distinct axes form outer products, and
additional distinct axes preserve tensor rank.

## Install VKF 0.1.2

Download the [0.1.2 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.2).

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

The 0.1.2 release compiles every documented program 100 times from fresh paths
and executes it 100 times in fresh operating-system processes on Windows x64,
Linux x64, and macOS ARM64. Reports record every sample, exact output, source
hash, compiler hash, and machine conditions. The 10-million-operation container
case keeps its workload fixed even when timings change.

<!-- readme-platform-evidence:start -->
| Detail | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Measured UTC | `2026-08-22T09:51:01.458Z` | `2026-08-22T09:48:21.376Z` | `2026-08-22T09:47:19.920Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | AMD EPYC 7763 64-Core Processor | AMD EPYC 7763 64-Core Processor | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 3,677,184 bytes | 4,754,240 bytes | 2,169,272 bytes |
| Compiler SHA-256 | `be8620b66c2581b888b35f602d1b140e24b0e5c9e3e6fb09551631746d81660f` | `81cbcb6a2f27c4382c259d19af424bbd4657c209b42f4d4fa31e841ae0a5b44f` | `96d74dba30aee633828b49ea8607da9a15bc90f8039bca8d448a0760ed489f6e` |
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
Measured on `linux 6.17.0-1022-azure`, `x64`, INTEL(R) XEON(R) PLATINUM 8573C, 4 logical CPUs, at `2026-08-22T09:58:26.404Z`.

Every table cell is mean ± sample standard deviation from 100 measured runs. Fresh-process compile includes tool startup for every language. Julia parses source and JIT-compiles during runtime; Python produces bytecode; native toolchains emit executables. VKF compiler-core time excludes compiler startup and is the separate <10 ms gate. Raw VKF machine-entry time is the separate <500 µs gate.

### Startup and output

Mode: **matched**. print one numeric value.

```vkf
:: 0
```

All implementations returned the same checked numeric result within tolerance: `0`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 2.292 ± 1.819 ms | 0.082 ± 0.012 ms | 1.704 ± 0.113 ms | 0.000 ± 0.000 ms | [source](benchmarks/core-comparison/published/startup/vkf.vkf) |
| C | 57.530 ± 21.477 ms | — | 1.476 ± 0.140 ms | — | [source](benchmarks/core-comparison/published/startup/c.c) |
| Rust | 53.572 ± 1.217 ms | — | 1.580 ± 0.102 ms | — | [source](benchmarks/core-comparison/published/startup/rust.rs) |
| Zig | 128.783 ± 19.435 ms | — | 1.411 ± 0.092 ms | — | [source](benchmarks/core-comparison/published/startup/zig.zig) |
| Go | 78.489 ± 1.656 ms | — | 2.331 ± 0.177 ms | — | [source](benchmarks/core-comparison/published/startup/go.go) |
| Julia | 171.563 ± 3.628 ms | — | 198.827 ± 5.412 ms | — | [source](benchmarks/core-comparison/published/startup/julia.jl) |
| Python | 37.906 ± 1.820 ms | — | 12.627 ± 0.357 ms | — | [source](benchmarks/core-comparison/published/startup/python-efficient.py) |

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
| VKF | 3.123 ± 0.191 ms | 0.757 ± 0.021 ms | 2.008 ± 0.156 ms | 0.241 ± 0.010 ms | [source](benchmarks/core-comparison/published/scalar-control-small/vkf.vkf) |
| C | 61.619 ± 9.876 ms | — | 1.607 ± 0.150 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/c.c) |
| Rust | 62.234 ± 1.940 ms | — | 1.723 ± 0.124 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/rust.rs) |
| Zig | 133.286 ± 3.259 ms | — | 1.567 ± 0.104 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/zig.zig) |
| Go | 79.534 ± 2.568 ms | — | 2.395 ± 0.189 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/go.go) |
| Julia | 174.199 ± 2.456 ms | — | 509.696 ± 10.062 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/julia.jl) |
| Python | 38.621 ± 1.405 ms | — | 14.801 ± 0.707 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/python-efficient.py) |

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
| VKF | 3.838 ± 1.286 ms | 1.216 ± 0.041 ms | 2.900 ± 0.141 ms | 1.079 ± 0.028 ms | [source](benchmarks/core-comparison/published/fixed-vector-medium/vkf.vkf) |
| C | 66.070 ± 20.458 ms | — | 1.876 ± 0.182 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/c.c) |
| Rust | 66.940 ± 1.036 ms | — | 2.144 ± 0.129 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/rust.rs) |
| Zig | 131.879 ± 3.029 ms | — | 1.876 ± 0.140 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/zig.zig) |
| Go | 80.540 ± 1.971 ms | — | 2.622 ± 0.175 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/go.go) |
| Julia | 175.113 ± 2.670 ms | — | 945.010 ± 10.775 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/julia.jl) |
| Python | 38.667 ± 1.137 ms | — | 100.851 ± 1.804 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/python-efficient.py) |

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
| VKF | 3.654 ± 0.192 ms | 1.172 ± 0.038 ms | 2.873 ± 0.183 ms | 1.069 ± 0.031 ms | [source](benchmarks/core-comparison/published/record-value-medium/vkf.vkf) |
| C | 61.809 ± 7.192 ms | — | 1.719 ± 0.146 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/c.c) |
| Rust | 67.207 ± 1.455 ms | — | 2.005 ± 0.145 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/rust.rs) |
| Zig | 135.585 ± 2.322 ms | — | 1.754 ± 0.158 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/zig.zig) |
| Go | 81.698 ± 2.243 ms | — | 2.545 ± 0.176 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/go.go) |
| Julia | 174.562 ± 4.632 ms | — | 939.213 ± 14.442 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/julia.jl) |
| Python | 39.251 ± 0.799 ms | — | 99.521 ± 2.362 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/python-efficient.py) |

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

The 0.1.2 native release includes `math`, `stat`, `random`, `time`, `io`,
`collections`, `errors`, `system`, `process`, and `regex`. Only fully native,
verified libraries ship. `physics`, `ui`, and `symbolic` remain future work.

The release gate currently contains **296 VKF tests** plus 59 documented-program
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
