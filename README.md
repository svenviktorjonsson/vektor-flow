# Vektor Flow

**Designed by Viktor Jonsson.**

**VKF automatically lifts ordinary typed functions through vectors while keeping tuples and records explicit.**

Vektor Flow (VKF) is an experimental language for compact native programs,
structured data, mathematics, and eventually visual applications.

> [!WARNING]
> VKF 0.2.1 is an unsupported experimental preview. It has bugs, incomplete
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

## Install VKF 0.2.1

Download the [0.2.1 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.2.1).

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

## Basic Syntax

VKF uses indentation for blocks and keeps control flow postfix and compact.

| Form | Meaning |
| --- | --- |
| `name: value` | Declare a new binding. |
| `.name: value` | Update an existing binding. |
| `condition? expression` | Run once when the condition is true. |
| `condition?>` | Repeat while the condition is true. |
| `value??` | Match a value or type using `=>` arms. |
| `value??>` | Repeatedly match a changing value. |
| `values >> expression` | Pipe each vector/range element through an expression; `$` is the current value. |
| `first; second` | End one row and begin another at the same logical indentation. |
| `@:` / `@` | Return a value / return `null`. |
| `@>` / `@\|` | Continue / break the nearest loop or pipe. |
| `:: value` | Print a value and newline. |

An indented pipe body runs once for each input. Its final value becomes `$` for
the next `>>` stage, and a dotted assignment can update an existing outer binding.
As the sole unparenthesized value inside `[]` or `{}`, a pipe generates that
container: `[a >> $]` equals `[:a]`, and `{a >> $}` equals `{:a}`. Parentheses
suppress generation, so `[(a >> $)]` contains the result tuple as one element.

Semicolons are useful for short multi-row pipe stages. Spaces after `;` do not
change indentation. For a longer pipeline, prefer an indented value-producing
block such as `result:` over wrapping the complete pipeline in parentheses.

This complete program uses a range pipe for fixed counting and a repeated match (switch) loop:

<!-- readme-example: core/33-loops.vkf -->
```vkf
loop_total() -> int:
    total: 0
    ..4 >>
        .total+: $
    total

switch_loop() -> int:
    k: 0
    k??>
        0 =>
            .k: k + 1
            @>
        1 =>
            .k: k + 1
            @>
        2 => @|
    k

:: loop_total()
:: switch_loop()
```

<!-- readme-evidence:start core/33-loops.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
10
2
```

<!-- readme-evidence:end -->

The [complete language guide](docs/language-guide.md) covers values, functions,
vectors, ranges, errors, operator overloads, modules, axes, and every native
standard library with runnable examples. The [VKF style guide](docs/style-guide.md)
records the compact canonical forms used by public VKF programs.

## Performance Evidence—And Its Limits

The 0.2.1 release gate compiles every documented program 10 times from fresh
paths and executes it 10 times in fresh operating-system processes on Windows
x64, Linux x64, and macOS ARM64. All 10 rounds must produce the same exit code
and byte-identical stdout and stderr. This is an output-stability check, not a
per-example timing claim.

The comparative timings below were produced by the 0.2.1 compiler from its
canonical compact benchmark sources. Every reported VKF compile forces a fresh
policy search; search time is included in total compile time and separately
recorded in the laboratory evidence.

<!-- readme-platform-evidence:start -->
| Detail | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Measured UTC | `2026-08-24T12:57:36.182Z` | `2026-08-24T12:55:53.931Z` | `2026-08-24T12:54:48.630Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | AMD EPYC 7763 64-Core Processor | AMD EPYC 9V74 80-Core Processor | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 4,310,528 bytes | 5,472,440 bytes | 2,423,080 bytes |
| Compiler SHA-256 | `57a1345207d192f64cd0adaf9af18bad5977071362e7d75b253bba17e26ea2fc` | `dfcad593ec22f58345a70644d2d1988439983ba8074fffd7ca7abe86ea7d0559` | `3368be26fe7ee8d19d633761a2d618c00b91f1df934c36e1fe39b3f453be8f17` |
<!-- readme-platform-evidence:end -->

These narrow 0.2.1 checks prove reproducibility and expose regressions. They
do **not** prove that VKF is generally faster than C, Rust, Zig, Go, Julia, or
Python.

### Adaptive Optimizer Policy Landscape

VKF represents lowering choices as data, verifies multiple legal variants,
deduplicates identical machine code, and retains a policy for the exact program
and x64 host. Normal search is bounded by the compilation-time budget;
exhaustive search is an explicit benchmark mode.

The latest committed [256-policy spectral-norm landscape](benchmarks/policy-landscape/evidence/windows-x64-v0.2.1-ci.md)
was produced by the strict 0.2.1 Windows x64 compiler. All 256 policies were
correct and collapsed to 36 distinct binaries. The fastest measured basin was
5.32× faster than the slowest. This run selected `mask-4e` at
2.291 ± 0.081 ms; the default `mask-ff` measured 2.318 ± 0.098 ms. Their 1.2%
difference is smaller than run-to-run variance. The report explains every
switch, exact conditions, code deduplication, and why small noisy differences
are not treated as proof.

### Reproducible Language Comparison

This is the controlled **0.2.1** comparison produced by the current compiler
and the exact VKF snippets shown below.

Rows marked **matched** use the same algorithm. The spectral-norm row is
**idiomatic**, so each native compiler may use its normal optimized route. VKF
is the only code displayed; the exact C, Rust, and Zig implementations are
linked. Tool versions, source hashes, work counts, output parity, compile
models, and all 1,000 raw timing samples are retained in the evidence report.

<!-- readme-comparison-evidence:start -->
Measured on `linux 6.17.0-1022-azure`, `x64`, AMD EPYC 9V74 80-Core Processor, 4 logical CPUs, at `2026-08-24T13:05:18.860Z`.

Only the three substantial optimization kernels are timed. VKF provides the absolute reference; C, Rust, and Zig are represented by same-host VKF/competitor ratios. Absolute times are never compared across machines. Each raw lane contains 1000 measured runs after 50 warmups and excludes process launch.

Evidence: [all samples and hashes](benchmarks/core-comparison/results/linux-x64-021.json) and [readable laboratory report](benchmarks/core-comparison/results/linux-x64-021.md).

### Current compile and raw-kernel comparison

Every ratio is `VKF mean / competitor mean` from the same Linux x64 runner. Raw runtime uses 1,000 measured runs; compile time uses 100 fresh compiles. VKF compile time includes its fresh policy search. A value above `1` means VKF took longer.

| Kernel | Measurement | VKF mean ± std | VKF / C | VKF / Rust | VKF / Zig |
| --- | --- | ---: | ---: | ---: | ---: |
| Spectral norm | Raw runtime | 4.7 ± 0.1 ms | 0.295× | 0.280× | 0.284× |
| Spectral norm | Compile | 322 ± 2 ms | 1.688× | 3.395× | 1.785× |
| Fannkuch | Raw runtime | 24.1 ± 0.3 ms | 1.035× | 1.216× | 1.063× |
| Fannkuch | Compile | 92.4 ± 0.5 ms | 1.036× | 1.024× | 0.543× |
| N-body | Raw runtime | 4.5 ± 0.3 ms | 1.336× | 1.904× | 0.984× |
| N-body | Compile | 123 ± 1 ms | 1.101× | 1.190× | 0.695× |

### spectral norm by power method — large, scale 500

Mode: **idiomatic**. Benchmarks Game power method; NumPy and Julia use optimized matrix operations.

```vkf
:.math

multiply_av(values:[num:500]) -> [num:500]:
    output: [0:500]
    ..500 - 1 >>
        i: $
        total: 0
        ..500 - 1 >>
            j: $
            diagonal: i + j
            .total+: (1 / (diagonal * (diagonal + 1) / 2 + i + 1)) * values.(j)
        output.(i): total
    @: output

multiply_atv(values:[num:500]) -> [num:500]:
    output: [0:500]
    ..500 - 1 >>
        i: $
        total: 0
        ..500 - 1 >>
            j: $
            diagonal: j + i
            .total+: (1 / (diagonal * (diagonal + 1) / 2 + j + 1)) * values.(j)
        output.(i): total
    @: output

multiply_at_av(values:[num:500]) -> [num:500]:
    multiply_atv(multiply_av(values))

spectral_norm() -> num:
    state: (u:[1:500], v:[0:500])
    ..9 >>
        state.v: multiply_at_av(state.u)
        state.u: multiply_at_av(state.v)
    u: state.u
    v: state.v
    result: (numerator:0, denominator:0)
    ..500 - 1 >>
        result.numerator +: u.($) * v.($)
        result.denominator +: v.($) * v.($)
    @: sqrt(result.numerator / result.denominator)

:: spectral_norm()
```

**Exact output (all implementations):**

```text
1.2742241159529069
```

Exact implementations: VKF [source](benchmarks/core-comparison/published/spectral-norm-large/vkf.vkf); C [source](benchmarks/core-comparison/published/spectral-norm-large/c.c); Rust [source](benchmarks/core-comparison/published/spectral-norm-large/rust.rs); Zig [source](benchmarks/core-comparison/published/spectral-norm-large/zig.zig).

### fannkuch-redux permutations — large, scale 9

Mode: **matched**. Benchmarks Game permutation order, checksum, and maximum-flip algorithm.

```vkf
fannkuch(n:int) -> int:
    permutation: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    working: [0:12]
    rotations: [0:12]
    control: (r:n, running:1, searching:0)
    result: (permutation_index:0, checksum:0, maximum_flips:0)
    flip: (left:0, right:0, temporary:0, head:0, count:0)
    control.running > 0?>
        control.r > 1?>
            rotations.(control.r - 1): control.r
            control.r -: 1

        ..n - 1 >> working.($): permutation.($)

        flip.count: 0
        flip.head: working.0
        flip.head != 0?>
            flip.left: 0
            flip.right: flip.head
            flip.left < flip.right?>
                flip.temporary: working.(flip.left)
                working.(flip.left): working.(flip.right)
                working.(flip.right): flip.temporary
                flip.left +: 1
                flip.right -: 1
            flip.count +: 1
            flip.head: working.0

        flip.count > result.maximum_flips?
            result.maximum_flips: flip.count
        result.permutation_index % 2 = 0?
            result.checksum +: flip.count
        result.permutation_index % 2 != 0?
            result.checksum -: flip.count

        control.searching: 1
        control.searching > 0?>
            control.r = n?
                control.running: 0
                control.searching: 0
            control.searching > 0?
                flip.temporary: permutation.0
                ..control.r - 1 >> permutation.($): permutation.($ + 1)
                permutation.(control.r): flip.temporary
                rotations.(control.r) -: 1
                rotations.(control.r) > 0?
                    control.searching: 0
                rotations.(control.r) = 0?
                    control.r +: 1
        control.running > 0?
            result.permutation_index +: 1
    @: result.checksum * 100 + result.maximum_flips

:: fannkuch(9)
```

**Exact output (all implementations):**

```text
862930
```

Exact implementations: VKF [source](benchmarks/core-comparison/published/fannkuch-redux-large/vkf.vkf); C [source](benchmarks/core-comparison/published/fannkuch-redux-large/c.c); Rust [source](benchmarks/core-comparison/published/fannkuch-redux-large/rust.rs); Zig [source](benchmarks/core-comparison/published/fannkuch-redux-large/zig.zig).

### five-body symplectic integration — large, scale 50,000

Mode: **matched**. Benchmarks Game Jovian-body constants and pairwise symplectic integrator.

```vkf
:.math

System: (positions:[[num:3]:5], velocities:[[num:3]:5], masses:[num:5])

offset_momentum(system:System, solar_mass:num) -> System:
    :system
    momentum: [0, 0, 0]
    ..4 >>
        i: $
        .momentum+: velocities.(i) * masses.(i)
    velocities.0: momentum * (-1 / solar_mass)
    @: (positions:positions, velocities:velocities, masses:masses)

advance(system:System, timestep:num) -> System:
    :system
    ..3 >>
        i: $
        (i + 1)..4 >>
            j: $
            [num:3] displacement: positions.(i) - positions.(j)
            magnitude: timestep / |displacement|^3
            velocities.(i) -: displacement * masses.(j) * magnitude
            velocities.(j) +: displacement * masses.(i) * magnitude
    ..4 >>
        i: $
        positions.(i) +: velocities.(i) * timestep
    @: (positions:positions, velocities:velocities, masses:masses)

system_energy(system:System) -> num:
    :system
    totals: (kinetic:0, potential:0)
    ..4 >>
        i: $
        totals.kinetic +: 0.5 * masses.(i) * |velocities.(i)|^2
    ..3 >>
        i: $
        (i + 1)..4 >>
            j: $
            [num:3] displacement: positions.(i) - positions.(j)
            totals.potential -: masses.(i) * masses.(j) / |displacement|
    @: totals.kinetic + totals.potential

n_body(steps:num) -> num:
    constants: (
        solar_mass:39.478417604357434,
        days_per_year:365.24,
        timestep:0.01
    )
    system: (
        positions:[
            [0, 0, 0],
            [4.841431442464721, -1.1603200440274284, -0.10362204447112311],
            [8.34336671824458, 4.124798564124305, -0.4035234171143214],
            [12.894369562139131, -15.111151401698631, -0.22330757889265573],
            [15.379697114850917, -25.919314609987964, 0.17925877295037118]
        ],
        velocities:[
            [0, 0, 0],
            [0.001660076642744037, 0.007699011184197404, -0.0000690460016972063] * constants.days_per_year,
            [-0.002767425107268624, 0.004998528012349172, 0.000023041729757376393] * constants.days_per_year,
            [0.002964601375647616, 0.0023784717395948095, -0.000029658956854023756] * constants.days_per_year,
            [0.0026806777249038932, 0.001628241700382423, -0.00009515922545197159] * constants.days_per_year
        ],
        masses:[
            constants.solar_mass,
            0.0009547919384243266 * constants.solar_mass,
            0.0002858859806661308 * constants.solar_mass,
            0.00004366244043351563 * constants.solar_mass,
            0.000051513890204661146 * constants.solar_mass
        ]
    )
    .system: offset_momentum(system, constants.solar_mass)
    ..steps - 1 >>
        .system: advance(system, constants.timestep)
    @: system_energy(system)

:: n_body(50000)
```

**Exact output (all implementations):**

```text
-0.16907807065935543
```

Exact implementations: VKF [source](benchmarks/core-comparison/published/n-body-large/vkf.vkf); C [source](benchmarks/core-comparison/published/n-body-large/c.c); Rust [source](benchmarks/core-comparison/published/n-body-large/rust.rs); Zig [source](benchmarks/core-comparison/published/n-body-large/zig.zig).

<details>
<summary>Exact toolchains and compile models</summary>

- VKF: `VKF 0.2.1; built with Ubuntu clang version 18.1.3 (1ubuntu1)`; fresh VKF process + fresh empirical policy search + Python-free integrated frontend + compiler-owned direct x64 artifact
- C: `Ubuntu clang version 18.1.3 (1ubuntu1)`; Clang -O3 -march=native native link
- Rust: `rustc 1.98.0 (88d9e12ae 2026-08-18)`; rustc -O -C target-cpu=native native link
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

The 0.2.1 native release includes `math`, `stat`, `random`, `time`, `io`,
`collections`, `errors`, `system`, `process`, and `regex`. Only fully native,
verified libraries ship. `physics`, `ui`, and `symbolic` remain future work.

The main-branch verification suite includes dedicated compact-index and
range-pipe regressions plus 60 documented-program checks. Exact output stays
beside the examples; controlled comparative timing remains separate.

## Punctuation At A Glance

| Syntax | Meaning |
| --- | --- |
| `:: value` | Print a value. |
| `::: value` | Print a labelled value. |
| `condition?` / `condition?>` | Conditional / loop while true. |
| `value??` / `value??>` | Match / repeated match. |
| `error!` / `expression!?` | Raise a typed error / catch errors. |
| `@:` / `@` | Return a value / return `null`. |
| `@>` / `@\|` | Continue / break. |
| `: .module` | Spill a module into the current scope. |

`!` is never factorial. Only error types and error values may be raised.

## Safety

The compiler refuses to overwrite an unrecognized existing file or a
symbolic-link output. Installers reject unsafe roots, non-VKF installation
folders, and unrelated existing `vkf` commands.

VKF programs still run with the current user's permissions. `io` can modify
files and `process` can launch programs. `process.run` passes an exact argument
vector; `process.shell` invokes a platform shell and must be treated as unsafe.

## 0.2.1 Changes

0.2.1 closes two correctness gaps found by exact documented-output checks and
makes compact integer and three-component vector kernels faster:

- compound vector updates inside functions retain their established fixed-vector type across consecutive operations;
- macOS ARM64 indexed access converts fixed integer locals through the numeric value ABI instead of reinterpreting integer bits as floating-point data;
- the documented-program harness now compares known high-value examples against committed exact stdout, in addition to checking repeated-run stability;
- discarded indexed pipe results no longer round-trip through a temporary, and fall-through-only pipe labels are removed before native lowering;
- fixed vector copies and bounded shifts are recognized directly from compact range-pipe IR;
- proven prefix-reversal indices remain in registers across the hot loop;
- scalar fields in structured integer locals can remain in registers while true indexed storage stays memory-backed;
- constant small-vector indices use direct frame addresses, and statically unrolled three-component interactions keep adjacent `x` and `y` lanes packed;
- the tuner validates a shape-guided small-vector policy against scalar output and uses a conservative policy when no search budget remains;
- Fannkuch uses its exact `int -> int` contract and is verified below `1.5×` C, Rust, and Zig on the controlled Linux runner;
- the native suite contains 333 passing VKF tests, with all documented outputs reverified on all three release platforms.

See the [0.2.1 release notes](docs/releases/0.2.1.md).

## 0.2.0 Changes

0.2.0 makes the compact vector model explicit and improves the native optimizer:

- implicit typed-function application descends recursively through vectors only; tuples and records remain whole values;
- nested vector sums and axis reductions are verified language behavior;
- public programs use range pipes, evaluated computed indices, vector arithmetic, and grouped records;
- unchanged aggregate results no longer produce identity self-copies in hot loops;
- integral index origins, direct integer branches, power-of-two remainders, and guarded fixed shifts receive dedicated lowering;
- hot loop headers are aligned and proven two-pointer fixed-vector reversals lower as one tight native loop;
- packed spectral-norm reductions survive compact range-pipe continuation labels;
- fixed-vector frame indices lower directly, while three-component affine, scaled-update, and symmetric pair interactions use compact packed/FMA kernels;
- optimizer profiles retain the exact tested policy, and runtime proof binds the executable and raw entry to the same canonical policy and code fingerprint;
- comparative compile figures include a fresh empirical policy search instead of reusing cached profiles;
- transferred string multisets keep owned operands alive across native calls;
- lexical shadowing, complex small powers, and nested-vector literal updates are fixed in machine lowering;
- the native suite contains 332 passing VKF tests;
- the landing README and numbered language guide no longer duplicate installation and release material;
- GitHub Pages deployment is removed; this README is the landing page.

See the [0.2.0 release notes](docs/releases/0.2.0.md).

## 0.1.8 Changes

0.1.8 makes compact indexing and looping executable language rules instead of
documentation style alone:

- a simple bound index uses `values.index`; computed and special indices use `values.(expression)`;
- inline indexed assignment is valid in a pipe, including `..n - 1 >> target.($): source.($)`;
- an indexed assignment pipes its stored value onward to a following `>>`;
- Fannkuch and the other public VKF sources use canonical compact indexing;
- discarded finite range pipes lower directly to counted loops without constructing result vectors;
- terminal-error numeric functions may retain hot scalar locals in registers, while index operands that require stack-backed addressing are excluded from the floating cache;
- call-free SysV numeric functions use XMM8 through XMM15 for hot locals, leaving XMM0 through XMM7 to expression and scratch lowering;
- the landing README now introduces bindings, conditionals, while loops, repeated matches, pipes, return, continue, and break;
- the native release suite reports 323 passing VKF tests on Windows x64;
- every documented example is compiled and executed 10 times per release platform with byte-identical output required; per-example timing is no longer presented as release evidence;
- the controlled Linux x64 comparison records 1,000 raw samples per lane, with every VKF/C, VKF/Rust, and VKF/Zig ratio below 2× for spectral norm, Fannkuch, and N-body.

See the [0.1.8 release notes](docs/releases/0.1.8.md).

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
