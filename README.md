# Vektor Flow

**Designed by Viktor Jonsson.**

**VKF automatically applies ordinary typed functions across compatible parts of structured data while preserving shape and metadata.**

Vektor Flow (VKF) is an experimental language for compact native programs,
structured data, mathematics, and eventually visual applications.

> [!WARNING]
> VKF 0.1.5 is an unsupported experimental preview. It has bugs, incomplete
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

## Install VKF 0.1.5

Download the [0.1.5 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.5).

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

The 0.1.4 release compiles every documented program 100 times from fresh paths
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

### Adaptive Optimizer Policy Landscape

0.1.5 can represent lowering choices as data, verify multiple legal variants,
deduplicate identical machine code, and retain a policy for the exact program
and x64 host. Normal search is bounded by the compilation-time budget;
exhaustive search is an explicit benchmark mode.

The latest [256-policy spectral-norm landscape](benchmarks/policy-landscape/evidence/windows-x64-v0.1.5.md)
was produced by the strict 0.1.5 Windows x64 compiler. All 256 policies were
correct and collapsed to 18 distinct binaries. The fastest basin was 2.64×
faster than the slowest. The latest run selected `mask-8e`, which emits the
same machine code and recorded the same 8.535 ± 3.433 ms as `mask-ff`; earlier
repeated runs selected different masks inside the same fast basin. The report
explains every switch, exact conditions, code deduplication, and why small noisy
differences are not treated as proof.

### Reproducible Language Comparison

Rows marked **matched** use the same algorithm. Rows marked **idiomatic** let
each ecosystem use its normal optimized route: NumPy/SciPy for Python and
linear algebra for Julia where appropriate. VKF is the only code displayed;
every other implementation is linked exactly. Tool versions, source hashes,
work counts, output parity, compile models, and 100-run dispersion are retained.

<!-- readme-comparison-evidence:start -->
Measured on `linux 6.17.0-1022-azure`, `x64`, AMD EPYC 7763 64-Core Processor, 4 logical CPUs, at `2026-08-22T17:40:14.362Z`.

Every table cell is mean ± sample standard deviation from 100 measured runs. Fresh-process compile includes tool startup for every language. Julia parses source and JIT-compiles during runtime; Python produces bytecode; native toolchains emit executables. VKF compiler-core time excludes compiler startup. The <10 ms compiler-core and <500 µs raw-entry limits apply only to the historical 20,000-operation scalar engineering gate. Raw kernel timing excludes process launch and is available where a stable native entry can be loaded.

### Startup and output

Mode: **matched**. print one numeric value.

```vkf
:: 0
```

All implementations returned the same checked numeric result within tolerance: `0`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw kernel | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 2.527 ± 0.067 ms | 0.125 ± 0.015 ms | 1.754 ± 0.094 ms | 0.000 ± 0.000 ms | [source](benchmarks/core-comparison/published/startup/vkf.vkf) |
| C | 61.241 ± 0.592 ms | — | 1.685 ± 0.136 ms | 0.000 ± 0.000 ms | [source](benchmarks/core-comparison/published/startup/c.c) |
| Rust | 56.955 ± 0.505 ms | — | 1.764 ± 0.095 ms | 0.000 ± 0.000 ms | [source](benchmarks/core-comparison/published/startup/rust.rs) |
| Zig | 149.154 ± 2.274 ms | — | 1.612 ± 0.070 ms | 0.000 ± 0.000 ms | [source](benchmarks/core-comparison/published/startup/zig.zig) |
| Go | 84.246 ± 1.154 ms | — | 2.341 ± 0.119 ms | — | [source](benchmarks/core-comparison/published/startup/go.go) |
| Julia | 183.926 ± 1.507 ms | — | 211.820 ± 1.973 ms | — | [source](benchmarks/core-comparison/published/startup/julia.jl) |
| Python | 42.161 ± 0.404 ms | — | 13.827 ± 0.161 ms | — | [source](benchmarks/core-comparison/published/startup/python-efficient.py) |

### spectral norm by power method — medium, scale 250

Mode: **idiomatic**. Benchmarks Game power method; NumPy and Julia use optimized matrix operations.

```vkf
:.math

multiply_av(values:[num:250]) -> [num:250]:
    output: [0:250]
    row: 0
    column: 0
    total: 0
    diagonal: 0
    row < 250?>
        .column: 0
        .total: 0
        column < 250?>
            .diagonal: row + column
            .total: total + (1 / (diagonal * (diagonal + 1) / 2 + row + 1)) * values.(column)
            .column: column + 1
        output.(row): total
        .row: row + 1
    output

multiply_atv(values:[num:250]) -> [num:250]:
    output: [0:250]
    row: 0
    column: 0
    total: 0
    diagonal: 0
    row < 250?>
        .column: 0
        .total: 0
        column < 250?>
            .diagonal: column + row
            .total: total + (1 / (diagonal * (diagonal + 1) / 2 + column + 1)) * values.(column)
            .column: column + 1
        output.(row): total
        .row: row + 1
    output

multiply_at_av(values:[num:250]) -> [num:250]:
    multiply_atv(multiply_av(values))

spectral_norm() -> num:
    u: [1:250]
    v: [0:250]
    iteration: 0
    iteration < 10?>
        .v: multiply_at_av(u)
        .u: multiply_at_av(v)
        .iteration: iteration + 1
    index: 0
    numerator: 0
    denominator: 0
    index < 250?>
        .numerator: numerator + u.(index) * v.(index)
        .denominator: denominator + v.(index) * v.(index)
        .index: index + 1
    sqrt(numerator / denominator)

:: spectral_norm()
```

All implementations returned the same checked numeric result within tolerance: `1.2742238666431718`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw kernel | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 34.836 ± 0.670 ms | 27.284 ± 0.319 ms | 44.737 ± 0.142 ms | 42.499 ± 0.067 ms | [source](benchmarks/core-comparison/published/spectral-norm-medium/vkf.vkf) |
| C | 177.435 ± 1.930 ms | — | 5.377 ± 0.129 ms | 3.555 ± 0.006 ms | [source](benchmarks/core-comparison/published/spectral-norm-medium/c.c) |
| Rust | 86.256 ± 0.593 ms | — | 5.649 ± 0.140 ms | 3.595 ± 0.015 ms | [source](benchmarks/core-comparison/published/spectral-norm-medium/rust.rs) |
| Zig | 179.597 ± 2.291 ms | — | 5.347 ± 0.122 ms | 3.604 ± 0.006 ms | [source](benchmarks/core-comparison/published/spectral-norm-medium/zig.zig) |
| Go | 84.556 ± 1.523 ms | — | 6.280 ± 0.190 ms | — | [source](benchmarks/core-comparison/published/spectral-norm-medium/go.go) |
| Julia | 184.539 ± 1.405 ms | — | 379.843 ± 2.108 ms | — | [source](benchmarks/core-comparison/published/spectral-norm-medium/julia.jl) |
| Python | 42.558 ± 0.374 ms | — | 109.372 ± 1.321 ms | — | [source](benchmarks/core-comparison/published/spectral-norm-medium/python-efficient.py) |

### fannkuch-redux permutations — medium, scale 8

Mode: **matched**. Benchmarks Game permutation order, checksum, and maximum-flip algorithm.

```vkf
fannkuch(n:num) -> num:
    permutation: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    working: [0:12]
    rotations: [0:12]
    r: n
    permutation_index: 0
    checksum: 0
    maximum_flips: 0
    running: 1
    index: 0
    left: 0
    right: 0
    temporary: 0
    first: 0
    flips: 0
    searching: 0
    running > 0?>
        r > 1?>
            rotations.(r - 1): r
            .r: r - 1

        .index: 0
        index < n?>
            working.(index): permutation.(index)
            .index: index + 1

        .flips: 0
        .first: working.0
        first != 0?>
            .left: 0
            .right: first
            left < right?>
                .temporary: working.(left)
                working.(left): working.(right)
                working.(right): temporary
                .left: left + 1
                .right: right - 1
            .flips: flips + 1
            .first: working.0

        flips > maximum_flips?
            .maximum_flips: flips
        permutation_index % 2 = 0?
            .checksum: checksum + flips
        permutation_index % 2 != 0?
            .checksum: checksum - flips

        .searching: 1
        searching > 0?>
            r = n?
                .running: 0
                .searching: 0
            searching > 0?
                .temporary: permutation.0
                .index: 0
                index < r?>
                    permutation.(index): permutation.(index + 1)
                    .index: index + 1
                permutation.(r): temporary
                rotations.(r): rotations.(r) - 1
                rotations.(r) > 0?
                    .searching: 0
                rotations.(r) = 0?
                    .r: r + 1
        running > 0?
            .permutation_index: permutation_index + 1
    checksum * 100 + maximum_flips

:: fannkuch(8)
```

All implementations returned the same checked numeric result within tolerance: `161622`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw kernel | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 6.524 ± 0.097 ms | 2.849 ± 0.022 ms | 13.648 ± 0.110 ms | 11.398 ± 0.018 ms | [source](benchmarks/core-comparison/published/fannkuch-redux-medium/vkf.vkf) |
| C | 80.733 ± 0.795 ms | — | 3.772 ± 0.150 ms | 1.960 ± 0.013 ms | [source](benchmarks/core-comparison/published/fannkuch-redux-medium/c.c) |
| Rust | 81.591 ± 0.579 ms | — | 3.752 ± 0.114 ms | 1.712 ± 0.011 ms | [source](benchmarks/core-comparison/published/fannkuch-redux-medium/rust.rs) |
| Zig | 170.361 ± 3.292 ms | — | 3.686 ± 0.098 ms | 1.876 ± 0.005 ms | [source](benchmarks/core-comparison/published/fannkuch-redux-medium/zig.zig) |
| Go | 84.655 ± 1.443 ms | — | 4.484 ± 0.109 ms | — | [source](benchmarks/core-comparison/published/fannkuch-redux-medium/go.go) |
| Julia | 184.576 ± 1.388 ms | — | 272.812 ± 1.594 ms | — | [source](benchmarks/core-comparison/published/fannkuch-redux-medium/julia.jl) |
| Python | 42.683 ± 0.387 ms | — | 125.333 ± 3.348 ms | — | [source](benchmarks/core-comparison/published/fannkuch-redux-medium/python-efficient.py) |

### five-body symplectic integration — medium, scale 10,000

Mode: **matched**. Benchmarks Game Jovian-body constants and pairwise symplectic integrator.

```vkf
:.math

n_body(steps:num) -> num:
    solar_mass: 39.478417604357434
    days_per_year: 365.24
    x: [0, 4.841431442464721, 8.34336671824458, 12.894369562139131, 15.379697114850917]
    y: [0, -1.1603200440274284, 4.124798564124305, -15.111151401698631, -25.919314609987964]
    z: [0, -0.10362204447112311, -0.4035234171143214, -0.22330757889265573, 0.17925877295037118]
    vx: [0, 0.001660076642744037 * days_per_year, -0.002767425107268624 * days_per_year, 0.002964601375647616 * days_per_year, 0.0026806777249038932 * days_per_year]
    vy: [0, 0.007699011184197404 * days_per_year, 0.004998528012349172 * days_per_year, 0.0023784717395948095 * days_per_year, 0.001628241700382423 * days_per_year]
    vz: [0, -0.0000690460016972063 * days_per_year, 0.000023041729757376393 * days_per_year, -0.000029658956854023756 * days_per_year, -0.00009515922545197159 * days_per_year]
    mass: [solar_mass, 0.0009547919384243266 * solar_mass, 0.0002858859806661308 * solar_mass, 0.00004366244043351563 * solar_mass, 0.000051513890204661146 * solar_mass]
    momentum_x: 0
    momentum_y: 0
    momentum_z: 0
    body: 0
    body < 5?>
        .momentum_x: momentum_x + vx.(body) * mass.(body)
        .momentum_y: momentum_y + vy.(body) * mass.(body)
        .momentum_z: momentum_z + vz.(body) * mass.(body)
        .body: body + 1
    vx.(0): -momentum_x / solar_mass
    vy.(0): -momentum_y / solar_mass
    vz.(0): -momentum_z / solar_mass

    step: 0
    first: 0
    second: 0
    dx: 0
    dy: 0
    dz: 0
    distance_squared: 0
    magnitude: 0
    step < steps?>
        .first: 0
        first < 5?>
            .second: first + 1
            second < 5?>
                .dx: x.(first) - x.(second)
                .dy: y.(first) - y.(second)
                .dz: z.(first) - z.(second)
                .distance_squared: dx * dx + dy * dy + dz * dz
                .magnitude: 0.01 / (distance_squared * sqrt(distance_squared))
                vx.(first): vx.(first) - dx * mass.(second) * magnitude
                vy.(first): vy.(first) - dy * mass.(second) * magnitude
                vz.(first): vz.(first) - dz * mass.(second) * magnitude
                vx.(second): vx.(second) + dx * mass.(first) * magnitude
                vy.(second): vy.(second) + dy * mass.(first) * magnitude
                vz.(second): vz.(second) + dz * mass.(first) * magnitude
                .second: second + 1
            x.(first): x.(first) + 0.01 * vx.(first)
            y.(first): y.(first) + 0.01 * vy.(first)
            z.(first): z.(first) + 0.01 * vz.(first)
            .first: first + 1
        .step: step + 1

    energy: 0
    .first: 0
    first < 5?>
        .energy: energy + 0.5 * mass.(first) * (vx.(first) * vx.(first) + vy.(first) * vy.(first) + vz.(first) * vz.(first))
        .second: first + 1
        second < 5?>
            .dx: x.(first) - x.(second)
            .dy: y.(first) - y.(second)
            .dz: z.(first) - z.(second)
            .energy: energy - mass.(first) * mass.(second) / sqrt(dx * dx + dy * dy + dz * dz)
            .second: second + 1
        .first: first + 1
    energy

:: n_body(10000)
```

All implementations returned the same checked numeric result within tolerance: `-0.16901644126443094`.

| Language | Fresh-process compile | VKF compiler core | Fresh-process runtime | Raw kernel | Exact code |
| --- | ---: | ---: | ---: | ---: | --- |
| VKF | 16.214 ± 0.237 ms | 9.548 ± 0.043 ms | 3.940 ± 0.109 ms | 2.031 ± 0.012 ms | [source](benchmarks/core-comparison/published/n-body-medium/vkf.vkf) |
| C | 106.088 ± 0.703 ms | — | 2.355 ± 0.126 ms | 0.620 ± 0.010 ms | [source](benchmarks/core-comparison/published/n-body-medium/c.c) |
| Rust | 96.225 ± 0.606 ms | — | 2.462 ± 0.170 ms | 0.438 ± 0.008 ms | [source](benchmarks/core-comparison/published/n-body-medium/rust.rs) |
| Zig | 174.640 ± 2.622 ms | — | 2.536 ± 0.131 ms | 0.814 ± 0.006 ms | [source](benchmarks/core-comparison/published/n-body-medium/zig.zig) |
| Go | 84.167 ± 1.601 ms | — | 3.236 ± 0.116 ms | — | [source](benchmarks/core-comparison/published/n-body-medium/go.go) |
| Julia | 184.017 ± 1.494 ms | — | 1675.567 ± 20.587 ms | — | [source](benchmarks/core-comparison/published/n-body-medium/julia.jl) |
| Python | 43.231 ± 0.464 ms | — | 185.101 ± 3.668 ms | — | [source](benchmarks/core-comparison/published/n-body-medium/python-efficient.py) |

<details>
<summary>Exact toolchains and compile models</summary>

- VKF: `VKF 0.1.4; built with Ubuntu clang version 18.1.3 (1ubuntu1)`; fresh VKF process + Python-free integrated frontend + compiler-owned direct x64 artifact
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

The 0.1.5 native release includes `math`, `stat`, `random`, `time`, `io`,
`collections`, `errors`, `system`, `process`, and `regex`. Only fully native,
verified libraries ship. `physics`, `ui`, and `symbolic` remain future work.

The release gate currently contains **309 VKF tests** plus 59 documented-program
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

## 0.1.5 Changes

0.1.5 makes optimizer choices explicit, testable, and program-specific:

- eight legal lowering switches form a 256-policy search space;
- every timed candidate must match the scalar policy's result;
- byte-identical candidates are deduplicated before timing;
- a time-bounded search can retain a policy for the exact program and x64 host;
- fixed numeric matrix and dual-dot reductions receive safe packed x64 kernels;
- aggregate borrowing, direct aggregate results, native integer induction and
  addressing, parity specialization, and fused multiply-add are independently
  selectable lowering decisions;
- the Windows x64 emitter uses only volatile SIMD registers across generated
  entry calls, preserving the platform ABI;
- eleven optimizer-focused VKF tests cover results, scalar remainders, and
  resource-owning aggregate calls.

The complete [0.1.5 policy landscape](benchmarks/policy-landscape/evidence/windows-x64-v0.1.5.md)
records all 256 policies, 18 distinct binaries, correctness, code hashes, exact
conditions, and timing dispersion. Its 2.64× fastest-to-slowest spread is a
useful result; its latest 0.0% selected/default difference is explicitly
reported as noise-sensitive rather than a proven advantage. See the
[0.1.5 release notes](docs/releases/0.1.5.md).

## 0.1.4 Changes

0.1.4 replaces ad-hoc comparison programs with cited, recognizable kernels:

- spectral norm, n-body, and fannkuch-redux come from the Computer Language Benchmarks Game;
- every language implementation has exact published source and checked output;
- raw in-process kernel timing now covers VKF, C, Rust, and Zig;
- x64 lowering eliminates proven fixed-vector bounds checks, keeps hot indices in integer registers, and evaluates long numeric expressions in registers;
- literal-only call parameters propagate conservatively in numeric-scalar functions when every call agrees;
- Linux numeric output no longer writes a duplicate line;
- the native suite adds scalar-recurrence and fractional-index regression coverage.

The benchmark report remains evidence, not a universal speed claim. See the
[benchmark policy](docs/performance-benchmarks.md) and [0.1.4 release notes](docs/releases/0.1.4.md).

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
