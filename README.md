# Vektor Flow

**Designed by Viktor Jonsson.**

**VKF automatically lifts ordinary typed functions through vectors while keeping tuples and records explicit.**

Vektor Flow (VKF) is an experimental language for compact native programs,
structured data, mathematics, and eventually visual applications.

> [!WARNING]
> VKF 0.1.7 is an unsupported experimental preview. It has bugs, incomplete
> diagnostics, and unstable APIs and syntax. Do not use it for production or
> run untrusted VKF programs.
>
> The intended visual system is not native yet. `ui`, `physics`, and `symbolic`
> are deliberately absent from this release rather than using compatibility
> fallbacks.

## Why VKF Is Different

### Ordinary Functions Lift Through Vectors

<!-- readme-example: core/25-structural-compatibility.vkf -->
```vkf
double(value:int) -> int:
    value * 2

:: double([1, 2, 3])
:: double([[1, 2], [3, 4]])
```

<!-- readme-evidence:start core/25-structural-compatibility.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[2, 4, 6]
[[2, 4], [6, 8]]
```

<!-- readme-evidence:end -->

`double` accepts `int`, so VKF applies it to every exact `int` leaf reached
through vector layers. The rule is recursive for nested vectors. It never
searches tuples or records for compatible fields: those values require an exact
parameter type or an explicit operator overload. The [language guide](docs/language-guide.md#4-automatic-vector-function-application)
defines the complete rule.

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

<!-- readme-evidence:end -->

Matching axes compute element-wise. Distinct axes form outer products, and
additional distinct axes preserve tensor rank.

## Install VKF 0.1.7

Download the [0.1.7 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.7).

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

The 0.1.7 release compiles every documented program 100 times from fresh paths
and executes it 100 times in fresh operating-system processes on Windows x64,
Linux x64, and macOS ARM64. Reports record every sample, exact output, source
hash, compiler hash, and machine conditions.

<!-- readme-platform-evidence:start -->
| Detail | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Measured UTC | `2026-08-23T13:35:33.177Z` | `2026-08-23T13:30:26.962Z` | `2026-08-23T13:29:06.021Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | AMD EPYC 7763 64-Core Processor | Intel(R) Xeon(R) 6973P-C | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 4,003,840 bytes | 5,184,968 bytes | 2,261,160 bytes |
| Compiler SHA-256 | `1b7db43f6615fd79265591807ee0ad05f76a41053b8962015de296f2eb995098` | `e4cbaad17d3ad73b68c35f7409861472230371b91692288a2fb0c025e836c5e3` | `8adfc1ba36c6496d875cbd6a956f5a607c569f19d57acf7c4a54555c940c35b6` |
| Timing host | v22.23.2 `Node performance.now()` | v22.23.2 `Node performance.now()` | v22.23.1 `Node performance.now()` |
<!-- readme-platform-evidence:end -->

These absolute timings prove reproducibility and expose regressions. They do
**not** prove that VKF is generally faster than C, Rust, Zig, Go, Julia, or
Python.

### Adaptive Optimizer Policy Landscape

VKF represents lowering choices as data, verifies multiple legal variants,
deduplicate identical machine code, and retain a policy for the exact program
and x64 host. Normal search is bounded by the compilation-time budget;
exhaustive search is an explicit benchmark mode.

The latest [256-policy spectral-norm landscape](benchmarks/policy-landscape/evidence/windows-x64-v0.1.7-ci.md)
was produced by the strict 0.1.7 Windows x64 compiler. All 256 policies were
correct and collapsed to 18 distinct binaries. The fastest measured basin was
5.23× faster than the slowest. This run selected `mask-4e` at
2.300 ± 0.135 ms; the default `mask-ff` measured 2.302 ± 0.072 ms. Their 0.1%
difference is smaller than run-to-run variance. The report explains every
switch, exact conditions, code deduplication, and why small noisy differences
are not treated as proof.

### Reproducible Language Comparison

Rows marked **matched** use the same algorithm. The spectral-norm row is
**idiomatic**, so each native compiler may use its normal optimized route. VKF
is the only code displayed; the exact C, Rust, and Zig implementations are
linked. Tool versions, source hashes, work counts, output parity, compile
models, and all 1,000 raw timing samples are retained in the evidence report.

<!-- readme-comparison-evidence:start -->
Measured on `linux 6.6.87.2-microsoft-standard-WSL2`, `x64`, Intel(R) Core(TM) Ultra 7 255U, 14 logical CPUs, at `2026-08-23T13:23:03.410Z`.

Only the three substantial optimization kernels are timed. VKF provides the absolute reference; C, Rust, and Zig are same-host ratios to VKF. Absolute times are never compared across machines. Each raw lane contains 1000 measured runs after 50 warmups and excludes process launch.

Evidence: [all samples and hashes](benchmarks/core-comparison/results/linux-x64-017-controlled-1000.json) and [readable laboratory report](benchmarks/core-comparison/results/linux-x64-017-controlled-1000.md).

### Current raw-kernel comparison

Every ratio is `VKF mean / competitor mean` from the same Linux x64 runner and the same 1,000-run report. A value above `1` means VKF took longer.

| Kernel | VKF mean ± std | VKF / C | VKF / Rust | VKF / Zig |
| --- | ---: | ---: | ---: | ---: |
| Spectral norm | 5.739 ± 1.763 ms | 0.904× | 0.778× | 0.949× |
| Fannkuch | 4.920 ± 1.309 ms | 1.188× | 1.298× | 1.361× |
| N-body | 1.898 ± 0.763 ms | 1.510× | 1.959× | 1.536× |

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

**Exact output (all implementations):**

```text
1.2742238666431718
```

Exact implementations: VKF [source](benchmarks/core-comparison/published/spectral-norm-medium/vkf.vkf); C [source](benchmarks/core-comparison/published/spectral-norm-medium/c.c); Rust [source](benchmarks/core-comparison/published/spectral-norm-medium/rust.rs); Zig [source](benchmarks/core-comparison/published/spectral-norm-medium/zig.zig).

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

**Exact output (all implementations):**

```text
161622
```

Exact implementations: VKF [source](benchmarks/core-comparison/published/fannkuch-redux-medium/vkf.vkf); C [source](benchmarks/core-comparison/published/fannkuch-redux-medium/c.c); Rust [source](benchmarks/core-comparison/published/fannkuch-redux-medium/rust.rs); Zig [source](benchmarks/core-comparison/published/fannkuch-redux-medium/zig.zig).

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

**Exact output (all implementations):**

```text
-0.16901644126443094
```

Exact implementations: VKF [source](benchmarks/core-comparison/published/n-body-medium/vkf.vkf); C [source](benchmarks/core-comparison/published/n-body-medium/c.c); Rust [source](benchmarks/core-comparison/published/n-body-medium/rust.rs); Zig [source](benchmarks/core-comparison/published/n-body-medium/zig.zig).

<details>
<summary>Exact toolchains and compile models</summary>

- VKF: `VKF 0.1.7; built with Ubuntu clang version 18.1.3 (1ubuntu1)`; fresh VKF process + Python-free integrated frontend + compiler-owned direct x64 artifact
- C: `Ubuntu clang version 18.1.3 (1ubuntu1)`; Clang -O3 -march=native native link
- Rust: `rustc 1.75.0 (82e1608df 2023-12-21) (built from a source tarball)`; rustc -O -C target-cpu=native native link
- Zig: `0.16.0`; zig build-exe -O ReleaseFast -mcpu native -lc

</details>
<!-- readme-comparison-evidence:end -->

The [comparative benchmark laboratory](benchmarks/core-comparison/README.md)
contains reproduction commands and interpretation limits. Results are narrow
evidence, not a universal speed ranking.

Every displayed program keeps its exact verified output. Per-example
compile/runtime tables are intentionally omitted from this landing page; the
single table above summarizes the current comparative measurements.

## Status And Native Scope

The 0.1.7 native release includes `math`, `stat`, `random`, `time`, `io`,
`collections`, `errors`, `system`, `process`, and `regex`. Only fully native,
verified libraries ship. `physics`, `ui`, and `symbolic` remain future work.

The main-branch verification suite currently contains **320 VKF tests** plus 59 documented-program
checks. Exact output stays beside the examples; full timing samples remain in
the machine-readable evidence reports.

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

## 0.1.7 Changes

0.1.7 improves the general SysV x64 numeric register cache:

- call-free numeric functions can retain hot locals in XMM6 through XMM15;
- high XMM register moves now use the correct REX encoding;
- Windows keeps its ABI-safe XMM6/XMM7 path because XMM6 through XMM15 are nonvolatile there;
- the controlled same-host comparison uses 1,000 measured raw-kernel runs after 50 warmups;
- the front page keeps one timing table: VKF mean and sample standard deviation, plus same-host ratios to C, Rust, and Zig.

See the [0.1.7 release notes](docs/releases/0.1.7.md).

## 0.1.6 Changes

0.1.6 makes automatic function application strict and predictable:

- implicit lifting descends only through vector layers;
- lifted vector elements must match the parameter type exactly;
- tuples and records are atomic instead of being filtered field-by-field;
- tuple and record arithmetic requires an explicit operator overload;
- typed overload families are resolved before machine lowering, with no aggregate-shape guessing;
- `stat.sum` recursively reduces all vector dimensions by default;
- `stat.sum(axis:)` accepts an integer or tuple of integers, including negative axes, for fixed rectangular numeric vectors;
- integer vector sums retain their integer leaf type;
- invalid conversions, tuple/record lifting, duplicate axes, out-of-range axes, and tuple sums have dedicated compile-error coverage;
- the native VKF suite contains 320 passing tests;
- public benchmark tables report measurements without exposing internal acceptance limits.

See the [0.1.6 release notes](docs/releases/0.1.6.md).

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
- a dedicated integer-function tier safely unrolls recognized fixed copies and
  bounded overlapping vector shifts;
- explicit definitions and dotted updates strengthen induction/range proofs;
- Windows XMM6/XMM7 and x64 callee-saved integer registers use ABI-safe frame
  slots, while error-capable mixed numeric functions avoid unsafe caching;
- thirteen optimizer-focused VKF tests cover results, scalar remainders,
  resource ownership, bounded shifts, and index-error behavior.

The complete [0.1.5 policy landscape](benchmarks/policy-landscape/evidence/windows-x64-v0.1.5.md)
records all 256 policies, 18 distinct binaries, correctness, code hashes, exact
conditions, and timing dispersion. Its 6.16× fastest-to-slowest spread is a
useful result; its latest 0.4% selected/default difference is explicitly
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
- compound vector arithmetic updates vector elements; tuple and record arithmetic requires an explicit operator overload;
- `: .errors` exposes bare error types, `Error!` raises a default error, and ordinary values such as `2!` are rejected;
- `vkf -t` verifies exact expected compile failures as well as successful tests;
- `vkf -v` identifies the embedded compiler release, and proof rejects package/compiler version mismatches;
- every documented program has source-hash-bound exact output and retained
  three-platform 100-run evidence reports.

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
