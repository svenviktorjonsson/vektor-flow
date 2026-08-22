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
| Compile | 3.345 ± 0.417 ms | 0.464 ± 0.051 ms | 1.396 ± 1.555 ms |
| Runtime | 24.356 ± 35.366 ms | 1.514 ± 0.050 ms | 3.109 ± 1.427 ms |

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
| Compile | 5.212 ± 0.504 ms | 0.780 ± 0.545 ms | 1.478 ± 0.598 ms |
| Runtime | 19.901 ± 2.058 ms | 1.578 ± 0.055 ms | 3.522 ± 3.505 ms |

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
hash, compiler hash, and machine conditions.

<!-- readme-platform-evidence:start -->
| Detail | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Measured UTC | `2026-08-22T13:05:20.754Z` | `2026-08-22T13:02:11.852Z` | `2026-08-22T13:01:41.735Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | AMD EPYC 9V74 80-Core Processor | AMD EPYC 9V74 80-Core Processor | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 3,692,032 bytes | 4,844,792 bytes | 2,186,792 bytes |
| Compiler SHA-256 | `19ff09914f4ba6ded29aae2f31876621e33715d6f2bdbf07e3dc214ceb65bffe` | `18bcda7d18321f8841ca2fa394992d14b24dddfdf9f6e00f1c20c4fd68ac23f7` | `882df4117dc3ad7307f9a488dd305181790edef98330cbadb5baf91d15728d1e` |
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
Measured on `linux 6.17.0-1022-azure`, `x64`, Intel(R) Xeon(R) 6973P-C, 4 logical CPUs, at `2026-08-22T13:09:38.840Z`.

Every table cell is mean ± sample standard deviation from 100 measured runs. Fresh-process compile includes tool startup for every language. Julia parses source and JIT-compiles during runtime; Python produces bytecode; native toolchains emit executables. VKF compiler-core time excludes compiler startup and is the separate <10 ms gate. Raw VKF machine-entry time is the separate <500 µs gate.

### Startup and output

Mode: **matched**. print one numeric value.

```vkf
:: 0
```

All implementations returned the same checked numeric result within tolerance: `0`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 1.947 ± 0.067 ms | 0.066 ± 0.017 ms | 1.242 ± 0.106 ms | 0.000 ± 0.000 ms | [source](benchmarks/core-comparison/published/startup/vkf.vkf) |
| C | 40.644 ± 4.059 ms | — | 1.157 ± 0.090 ms | — | [source](benchmarks/core-comparison/published/startup/c.c) |
| Rust | 43.006 ± 2.579 ms | — | 1.253 ± 0.076 ms | — | [source](benchmarks/core-comparison/published/startup/rust.rs) |
| Zig | 98.652 ± 5.187 ms | — | 1.134 ± 0.068 ms | — | [source](benchmarks/core-comparison/published/startup/zig.zig) |
| Go | 58.197 ± 2.937 ms | — | 1.993 ± 0.224 ms | — | [source](benchmarks/core-comparison/published/startup/go.go) |
| Julia | 148.505 ± 6.905 ms | — | 164.874 ± 4.421 ms | — | [source](benchmarks/core-comparison/published/startup/julia.jl) |
| Python | 28.026 ± 0.841 ms | — | 9.785 ± 0.384 ms | — | [source](benchmarks/core-comparison/published/startup/python-efficient.py) |

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
| VKF | 2.469 ± 0.095 ms | 0.567 ± 0.022 ms | 1.515 ± 0.155 ms | 0.082 ± 0.003 ms | [source](benchmarks/core-comparison/published/scalar-control-small/vkf.vkf) |
| C | 40.594 ± 17.799 ms | — | 1.353 ± 0.142 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/c.c) |
| Rust | 45.887 ± 0.809 ms | — | 1.382 ± 0.092 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/rust.rs) |
| Zig | 98.223 ± 4.134 ms | — | 1.288 ± 0.111 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/zig.zig) |
| Go | 58.964 ± 4.252 ms | — | 2.046 ± 0.154 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/go.go) |
| Julia | 146.256 ± 6.642 ms | — | 400.179 ± 13.427 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/julia.jl) |
| Python | 27.961 ± 1.022 ms | — | 11.563 ± 0.539 ms | — | [source](benchmarks/core-comparison/published/scalar-control-small/python-efficient.py) |

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

All implementations returned the same checked numeric result within tolerance: `10.099567298080492`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 2.897 ± 0.667 ms | 0.864 ± 0.027 ms | 1.782 ± 0.206 ms | 0.183 ± 0.009 ms | [source](benchmarks/core-comparison/published/fixed-vector-medium/vkf.vkf) |
| C | 42.781 ± 5.919 ms | — | 1.576 ± 0.163 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/c.c) |
| Rust | 53.091 ± 3.153 ms | — | 1.584 ± 0.100 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/rust.rs) |
| Zig | 100.504 ± 3.792 ms | — | 1.467 ± 0.120 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/zig.zig) |
| Go | 58.787 ± 2.204 ms | — | 2.178 ± 0.164 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/go.go) |
| Julia | 147.972 ± 7.064 ms | — | 734.944 ± 22.509 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/julia.jl) |
| Python | 28.292 ± 1.166 ms | — | 73.106 ± 2.424 ms | — | [source](benchmarks/core-comparison/published/fixed-vector-medium/python-efficient.py) |

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

All implementations returned the same checked numeric result within tolerance: `-2.0473715203632314e+23`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw VKF machine entry | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 2.831 ± 0.308 ms | 0.822 ± 0.017 ms | 1.660 ± 0.185 ms | 0.100 ± 0.004 ms | [source](benchmarks/core-comparison/published/record-value-medium/vkf.vkf) |
| C | 43.385 ± 10.440 ms | — | 1.504 ± 0.179 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/c.c) |
| Rust | 53.315 ± 1.836 ms | — | 1.491 ± 0.103 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/rust.rs) |
| Zig | 103.911 ± 4.873 ms | — | 1.371 ± 0.115 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/zig.zig) |
| Go | 62.982 ± 15.378 ms | — | 2.164 ± 0.175 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/go.go) |
| Julia | 150.089 ± 6.037 ms | — | 728.966 ± 19.962 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/julia.jl) |
| Python | 27.735 ± 0.500 ms | — | 73.054 ± 1.896 ms | — | [source](benchmarks/core-comparison/published/record-value-medium/python-efficient.py) |

<details>
<summary>Exact toolchains and compile models</summary>

- VKF: `VKF 0.1.3; built with Ubuntu clang version 18.1.3 (1ubuntu1)`; fresh VKF process + Python-free integrated frontend + compiler-owned direct x64 artifact
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
