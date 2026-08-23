# Vektor Flow Language Guide

**Designed by Viktor Jonsson.**

Vektor Flow (VKF) is an experimental, scope-based language for compact native programs, structured data, mathematics, and eventually visual applications.

Its central ideas are bindings that build scope, blocks that return values, callable types, structural operations, and functions that automatically apply across compatible elements.

> [!WARNING]
> VKF 0.1.5 is an experimental preview, not a supported production language. It has bugs, incomplete diagnostics, and unstable APIs and syntax.
>
> The visual system is intended to become VKF's strongest feature, but `ui`, `physics`, and `symbolic` are not included in the native 0.1.5 release.

## Release History

### 0.1.5 — Adaptive Native Optimization

0.1.5 represents eight legal x64 lowering choices as policy data. The compiler
can verify and time program-specific variants within a compilation budget,
deduplicate identical machine code, and retain the selected policy for the exact
program and host. Safe packed matrix and dual-dot reductions join aggregate
forwarding, native integer/index lowering, parity specialization, and FMA as
independent decisions. The release gate contains 309 native VKF tests plus
fresh 100-run proof and a committed 256-policy landscape.

### 0.1.4 — Standard Kernels And Numeric Lowering

0.1.4 replaces ad-hoc comparisons with cited spectral-norm, fannkuch-redux,
and n-body kernels. Exact seven-language source and output are verified. Direct
x64 lowering removes proven fixed-vector checks, evaluates long numeric
expressions in registers, and keeps hot proven indices in integer registers.
Unproven and fractional indices retain their errors. The release gate contains
301 native VKF tests plus fresh 100-run proof.

### 0.1.3 — Native Numeric Optimization

0.1.3 keeps the language surface stable while improving direct x64 code:

- straight-line numeric functions with tuple, vector, or record results can inline into hot loops;
- arithmetic, comparisons, branches, stores, and repeated local loads are fused;
- supported x64 hosts use AVX2/FMA for recognized four-lane affine recurrences;
- the x64 SysV record recurrence keeps its four numeric fields in registers;
- pure numeric Linux programs use a minimal executable shell;
- that shell uses dedicated numeric conversion plus a direct write syscall;
- x64 CPU features are included in executable fingerprints;
- native regression tests verify optimized vector and record results.

Every benchmark keeps its previous source and fixed work count. The release
gate contains 298 native VKF tests plus fresh 100-run proof.

### 0.1.2 — Explicit Bindings And Inline Proof

0.1.2 removes silent variable overwrites and makes this guide a
source-hash-bound release-evidence surface:

- `name: value` now only declares; repeating it in the same scope is a compile error;
- `.name: value` now only updates the nearest reachable name; a missing name is a compile error;
- every compound assignment also requires the dot, such as `.name +: value`; undotted `name +: value` is rejected;
- declaration and update assignments work as expressions and return the stored value;
- function parameters count as existing declarations and may only be updated with dot syntax;
- `alias: .folder.file` remains separate: its dotted import path is on the right side of `:`;
- structural compound arithmetic updates compatible leaves while preserving incompatible metadata;
- bare spilled error types may be raised, while `2!` and other ordinary-value raises are compile errors;
- native `vkf -t` now verifies both successful programs and exact expected compile failures;
- `vkf -v` exposes embedded release identity so proof cannot label a stale compiler as current;
- every documented program shows exact output and a two-row Windows/Linux/macOS timing table generated only from matching 0.1.2 source hashes and compilers.

### 0.1.1 — Native Backend Parity

0.1.1 fills the executable-backend and release-test gaps found while verifying this guide against the complete compiler:

- fixed nested and local function registration, stored lambdas, and returned or stored closures;
- fixed tuple/vector literal spread and fixed-shape literal classification;
- fixed compound aggregate updates while preserving aliases;
- fixed named record aliases inside fixed containers and structural projections;
- fixed multiple complex outputs through the native formatter;
- fixed chained named-axis products so `i * j * k` preserves tensor rank;
- fixed local values shadowing stdlib module names;
- fixed macOS ARM64 four-byte UTF-8 formatting and monotonic-clock selection;
- corrected regex documentation to use source-first arguments and its real capture results;
- moved native test artifacts out of source discovery, restored the original public-test convention, and added the full `vkf -t tests/vkf` release gate;
- replaced the narrow synthetic release benchmark with 100 fresh compiles and 100 full-process runs of every documented example, including exact output proof and a 20-million-operation container stress case.

Release verification reports **279 passed, 0 failed on each of Windows x64, Linux x64, and macOS ARM64** through the native VKF test runner.

### 0.1.0 — First Native Preview

0.1.0 introduced the Python-free native compiler, installers for three operating systems, the short command interface, executable reuse, the first complete native stdlib set, and the 20k performance gate.

## Download And Run VKF 0.1.5

Download VKF from the [0.1.5 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.5).

| Platform | Recommended download | Installation |
| --- | --- | --- |
| Windows x64 | `vektor-flow-windows-x64-setup.exe` | Run it and select **Add VKF to PATH**. |
| Linux x64 (Debian/Ubuntu) | `vektor-flow-linux-x64.deb` | Run `sudo apt install ./vektor-flow-linux-x64.deb`. |
| macOS Apple Silicon | `vektor-flow-macos-arm64.pkg` | Open it and follow the installer. |

Portable `.zip` and `.tar.gz` archives are on the same release page. Linux and macOS archives include a per-user `install.sh`; do not run that script with `sudo`.

Open a new terminal and verify the compiler:

```bash
vkf -e ':: "hello, world"'
```

The installed compiler requires no Python, C++ compiler, assembler, or separate linker.

### Commands

VKF uses one executable and short, single-purpose flags.

| Command | Result |
| --- | --- |
| `vkf program.vkf` | Build beside the source when needed, then run. |
| `vkf program.vkf -o app` | Build or reuse the named executable, then run. |
| `vkf -b program.vkf` | Build only. |
| `vkf -b program.vkf -o app` | Build only with an explicit output name. |
| `vkf -e ':: 2 + 2'` | Evaluate inline source. |
| `vkf -t tests.vkf` | Run native tests in a file or directory. |
| `vkf -v` | Print compiler release version. |

`-b` means build, `-e` means evaluate, `-t` means test, `-v` means version,
and `-o` names the executable. Passing a `.vkf` file is the run command; there
is no `-r`.

A fingerprint covers the source, compiler, imports, target, and output choice. An unchanged program can reuse its existing executable.

### Verified Guide Example Matrix

The release proof measures the 59 programs users actually see in this guide.
Directly below every VKF code example, this guide shows its exact recorded
output and a two-row, three-platform table. Each timing is the mean ± standard
deviation of 100 measured runs on Windows, Linux, and macOS.

Every example receives one compile warmup, **100 measured compiles from fresh
source paths**, five runtime warmups, and **100 measured executions in fresh
operating-system processes**. Every measured run must return the same exit code
and byte-identical stdout and stderr. Output blocks show the exact decoded text;
Windows uses CRLF line endings while Linux and macOS use LF.

The `Fresh executable build` row includes source reading, lexing, parsing,
native standard-library resolution, typed IR, machine lowering, and executable
emission. It uses one persistent compiler process, so the measurement excludes
compiler-process startup. The `Fresh-process launch + run` row includes OS
process creation, executable loading, any platform security inspection, program
work, output capture, and teardown. For tiny programs—especially on hosted
Windows runners—those fixed launch costs can dominate. This row is end-to-end
latency, not raw machine-code execution time.

These are the machines and conditions behind every inline table:

<!-- readme-platform-evidence:start -->
| Detail | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Measured UTC | `2026-08-23T02:26:44.944Z` | `2026-08-23T02:23:10.036Z` | `2026-08-23T02:22:26.494Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz | AMD EPYC 9V74 80-Core Processor | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 3,946,496 bytes | 5,101,192 bytes | 2,241,416 bytes |
| Compiler SHA-256 | `7d92eb5ac034ed593bcc50c17c6c830347563ec747edbfc7be8957e054b72f31` | `d35af761d7895c5b9c2d1635329bbf53a9dd21a7317b07bafe6d620fb1c6f02c` | `5798cec9fe98f99dab70e8f3e8099ac737ac105f9d457f91b714babe1a2d7bca` |
| Timing host | v22.23.2 `Node performance.now()` | v22.23.2 `Node performance.now()` | v22.23.1 `Node performance.now()` |
<!-- readme-platform-evidence:end -->

The dedicated `core/12b-container-stress.vkf` example always performs 10
million fixed-container element updates and reads, then prints only the
checksum. Its work count is never adjusted to target a preferred duration.

### Native 0.1.5 Scope

The release includes `math`, `stat`, `random`, `time`, `io`, `collections`, `errors`, `system`, `process`, and `regex`.

Only complete native libraries ship. The partial `physics`, `ui`, and `symbolic` libraries are absent instead of silently falling back to Python, C++, or another runtime.

### Safety

The compiler refuses to overwrite an unrecognized existing file or a symbolic-link output. Installers refuse unsafe roots, non-VKF installation folders, and unrelated existing `vkf` commands.

VKF programs still run with the current user's permissions. `io` can change files and `process` can launch programs. Do not run untrusted `.vkf` files or run VKF as administrator/root without a real need.

`process.run` sends an argument vector directly to a program. `process.shell` invokes the platform shell and must be treated as unsafe.

## Native Core Guide

This guide describes the native compiler, not the older Python interpreter. Its examples are extracted from this guide and checked against the native parser, lowering pipeline, executable backend, and core regression programs.

File extension: `.vkf`. Indentation forms suites. Comments begin with `#`.

## 1. Programs And Bindings

### 1.1 Declare With `name:` And Update With `.name:`

`name: value` declares a name; a type may appear before it. `.name: value`
updates the nearest reachable declaration. The leading dot makes accidental
creation impossible: `.missing: value` is a compile error telling you to
declare it first with `missing:value`.

| Form | Meaning | Expression result |
| --- | --- | --- |
| `name: value` | Declare a new name; fail if that name is already declared in this scope. | `value` |
| `.name: value` | Update the nearest reachable name; fail if none exists. | Stored `value` |
| `.name +: value` | Compound-update an existing name; the same rule covers the other compound operators. | New value of `name` |

An inner scope may deliberately shadow an outer name with `name:`. Within one
scope, use `.name:` for every later update. Function parameters already exist in
their function scope, so `.x +: 3` may update parameter `x`, while `x: 4` in the
same scope is a forbidden redeclaration. Module imports are separate:
`alias: .folder.file` has the dotted module path on the right of `:`.

<!-- readme-example: core/01-bindings.vkf -->
```vkf
value: 3
num scaled: value * 2
.value: value + 4
:: value
:: scaled
```

<!-- readme-evidence:start core/01-bindings.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
7
6
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.494 ± 0.479 ms | 0.399 ± 0.012 ms | 0.947 ± 0.867 ms |
| Fresh-process launch + run | 20.902 ± 3.053 ms | 1.491 ± 0.050 ms | 2.142 ± 0.501 ms |

<!-- readme-evidence:end -->

Declarations and updates are expressions; each returns the value it stored.
The same strict name rule applies inside an expression.

<!-- readme-example: core/02-bind-expression.vkf -->
```vkf
b: (a: 3) + 1
:: a
:: b
```

<!-- readme-evidence:start core/02-bind-expression.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
3
4
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.095 ± 0.462 ms | 0.286 ± 0.010 ms | 1.191 ± 4.017 ms |
| Fresh-process launch + run | 21.325 ± 3.735 ms | 1.480 ± 0.055 ms | 2.122 ± 0.573 ms |

<!-- readme-evidence:end -->

### 1.2 Blocks Produce Values And Scopes

An indented block returns its last row. A bare `:` returns the visible scope as a record.

<!-- readme-example: core/03-blocks.vkf -->
```vkf
make_message():
    first: "hello"
    first & " world"

make_base(x:int, y:int):
    :

make_colored(x:int, y:int, color:str):
    : make_base(x, y)
    :

message: make_message()
base: make_base(3, 4)
colored: make_colored(3, 4, "red")

:: message
:: base
:: colored.x
:: colored.color
```

<!-- readme-evidence:start core/03-blocks.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
hello world
make_base(x:3, y:4)
3
red
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 7.464 ± 6.875 ms | 0.949 ± 0.009 ms | 1.321 ± 0.254 ms |
| Fresh-process launch + run | 20.895 ± 2.947 ms | 1.515 ± 0.042 ms | 2.105 ± 0.597 ms |

<!-- readme-evidence:end -->

### 1.3 Output, Comments, And Assertions

`:: value` writes a value. `condition?!` asserts truth. An optional following expression is the error message.

<!-- readme-example: core/04-output-assert.vkf -->
```vkf
# Comments continue to the end of the row.
answer: 6 * 7
(answer == 42)?! "the answer changed"
:: answer
```

<!-- readme-evidence:start core/04-output-assert.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
42
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.262 ± 0.844 ms | 0.323 ± 0.010 ms | 0.854 ± 0.163 ms |
| Fresh-process launch + run | 25.229 ± 39.103 ms | 1.492 ± 0.062 ms | 2.059 ± 0.372 ms |

<!-- readme-evidence:end -->

### 1.4 Tagged Tests

`test` tags a function for `vkf -t`. A tagged function that needs required arguments is reported as incompatible instead of being called incorrectly. For 0.1 compatibility, a file with no explicit tags treats its public, callable `bit` functions as tests; names beginning with `_` remain helpers.

<!-- readme-example: core/05-tagged-test.vkf -->
```vkf
test addition_works() -> bit:
    2 + 2 = 4

test needs_input(value:int) -> bit:
    value = 1
```

<!-- readme-evidence:start core/05-tagged-test.vkf -->

**Recorded stdout (exit code `0`; stderr empty):** no output.

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 1.995 ± 0.270 ms | 0.333 ± 0.012 ms | 0.842 ± 0.242 ms |
| Fresh-process launch + run | 26.205 ± 48.994 ms | 1.477 ± 0.051 ms | 2.051 ± 0.379 ms |

<!-- readme-evidence:end -->

## 2. Values, Types, And Containers

### 2.1 Primitive Values And `null`

The primitive callable type handles are `bit`, `chr`, `int`, `num`, and `str`. `num` also represents complex numbers. A bare `@` returns `null`.

<!-- readme-example: core/06-primitives.vkf -->
```vkf
bit enabled: true
chr letter: chr(65)
int count: int(7.0)
num ratio: num(3) / 2
str label: str(count)

empty():
    @

:: enabled
:: letter
:: ratio
:: label
:: empty()
```

<!-- readme-evidence:start core/06-primitives.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
true
A
1.5
7
null
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.923 ± 0.439 ms | 0.693 ± 0.013 ms | 1.099 ± 0.211 ms |
| Fresh-process launch + run | 27.212 ± 60.440 ms | 1.509 ± 0.037 ms | 2.058 ± 0.359 ms |

<!-- readme-evidence:end -->

Primitive names are values. Calling one converts a compatible value; postfix `.` reflects a value or type. Primitive type values also expose their members when spilled.

<!-- readme-example: core/07-reflection.vkf -->
```vkf
NumberType: num
:: NumberType(4)
:: int.
:: [1, 2].

type_scope:
    reflected: int.
    :
:: type_scope
```

<!-- readme-evidence:start core/07-reflection.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
4
(any) -> int
[int:2]
(NumberType:num, reflected:(any) -> int)
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.943 ± 0.579 ms | 0.490 ± 0.011 ms | 0.967 ± 0.167 ms |
| Fresh-process launch + run | 50.370 ± 290.586 ms | 1.504 ± 0.051 ms | 2.038 ± 0.344 ms |

<!-- readme-evidence:end -->

`bool`, `byte`, `bytes`, and `float` are not primitive names. Use `bit`, `chr`, `str`, `num`, or a vector of `chr` values.

### 2.2 Strings, Characters, And Interpolation

`&` concatenates text and converts the other operand when needed. Strings compare by content and support `$name`, `$(expression)`, dotted paths, number formats, and escaped `\$`.

<!-- readme-example: core/08-strings.vkf -->
```vkf
name: "världen"
value: 4.2345
point: (x:2, y:false)

:: "Hej $name"
:: "value=$value.2f"
:: "sum=$(2 + 3) point=$point cost=\$5"
:: chr(128512)
```

<!-- readme-evidence:start core/08-strings.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
Hej världen
value=4.23
sum=5 point=(x:2, y:false) cost=$5
😀
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 4.090 ± 0.519 ms | 0.611 ± 0.012 ms | 1.055 ± 0.162 ms |
| Fresh-process launch + run | 22.502 ± 13.483 ms | 1.510 ± 0.050 ms | 2.043 ± 0.462 ms |

<!-- readme-evidence:end -->

### 2.3 Tuples And Records

Tuples use positional fields. Records use named fields. Fields are read with `.field` or `.index` and updated with `:`.

<!-- readme-example: core/09-tuples-records.vkf -->
```vkf
pair: (3, 4)
pair.0: 8

point: (name:"origin", x:3, y:4)
point.z: 5

:: pair.0 + pair.1
:: point.name
:: point.x + point.y + point.z
```

<!-- readme-evidence:start core/09-tuples-records.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
12
origin
12
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.236 ± 0.370 ms | 0.617 ± 0.010 ms | 1.032 ± 0.141 ms |
| Fresh-process launch + run | 21.476 ± 3.631 ms | 1.494 ± 0.044 ms | 2.005 ± 0.325 ms |

<!-- readme-evidence:end -->

### 2.4 Fixed And Dynamic Vectors

`[T:n]` is a fixed vector type and `[T]` is dynamic. A literal is fixed unless a dynamic type is requested. `[value:count]` repeats an element.

<!-- readme-example: core/11-vectors.vkf -->
```vkf
[int:3] fixed: [1, 2, 3]
[int] dynamic: [4, 5, 6]
repeated: [7:4, 9:2]

dynamic.1: 20

:: fixed
:: dynamic
:: repeated
```

<!-- readme-evidence:start core/11-vectors.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[1, 2, 3]
[4, 20, 6]
[7, 7, 7, 7, 9, 9]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.980 ± 0.518 ms | 0.535 ± 0.013 ms | 0.980 ± 0.159 ms |
| Fresh-process launch + run | 21.210 ± 3.952 ms | 1.535 ± 0.049 ms | 2.031 ± 0.389 ms |

<!-- readme-evidence:end -->

`&` concatenates vectors. Fixed vectors preserve their compile-time shape; dynamic vectors produce a dynamic result.

<!-- readme-example: core/12-vector-concat.vkf -->
```vkf
fixed: [1, 2] & [3]
dynamic: collections.list(1, 2) & collections.list(3)
:: fixed
:: dynamic
```

<!-- readme-evidence:start core/12-vector-concat.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[1, 2, 3]
[1, 2, 3]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.582 ± 0.494 ms | 0.506 ± 0.011 ms | 0.973 ± 0.141 ms |
| Fresh-process launch + run | 21.386 ± 4.334 ms | 1.507 ± 0.041 ms | 2.048 ± 0.469 ms |

<!-- readme-evidence:end -->

This deliberately heavy example performs 10 million fixed-container element
updates and reads. It is the runtime stress case in the per-example release
report; only its checksum is printed.

<!-- readme-example: core/12b-container-stress.vkf -->
```vkf
container_work(n:int) -> int:
    values: [1, 2, 3, 4]
    delta: [1, 2, 3, 4]
    i: 0
    checksum: 0
    i < n?>
        .values +: delta
        .values -: delta
        .checksum: checksum + values.0 + values.1 + values.2 + values.3
        .i: i + 1
    checksum

:: container_work(1000000)
```

<!-- readme-evidence:start core/12b-container-stress.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
10000000
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 5.697 ± 0.918 ms | 0.938 ± 0.011 ms | 1.230 ± 0.137 ms |
| Fresh-process launch + run | 43.590 ± 7.878 ms | 28.428 ± 0.078 ms | 42.466 ± 2.709 ms |

<!-- readme-evidence:end -->

### 2.5 Aggregate Updates And Aliases

Compound updates also require the explicit leading dot: `.name +:`, `.name -:`,
`.name *:`, `.name /:`, `.name //:`, `.name %:`, and `.name /\:`. The native
implementation preserves aggregate alias identity across these updates. Operators
distribute through structural values and update only compatible leaves. Other
fields, such as string metadata in a numeric update, remain unchanged.

<!-- readme-example: core/13-updates-aliases.vkf -->
```vkf
values: [1, 2]
alias: values
.values +: [3, 4]
.values *: 2
.values -: [2, 4]
.values /: 2
:: alias

Point(x, y):
    name: "my point"
    :

p: Point(3, 4)
.p +: 2
:: p
```

<!-- readme-evidence:start core/13-updates-aliases.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[3, 4]
Point(x:5, y:6, name:my point)
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 5.879 ± 0.810 ms | 0.899 ± 0.010 ms | 1.229 ± 0.198 ms |
| Fresh-process launch + run | 22.708 ± 13.391 ms | 1.661 ± 0.061 ms | 2.486 ± 0.470 ms |

<!-- readme-evidence:end -->

The exact output is `[3, 4]` followed by `Point(x:5, y:6, name:my point)`. This
behavior is compiler-tested. Do not assume that an aggregate update leaves an
older alias unchanged.

### 2.6 Multisets

`{value:count}` creates a multiset. Duplicate keys combine and nonpositive counts disappear. `+` or `&` adds counts, `-` subtracts, `//` divides matching counts, and `%` keeps remainders.

<!-- readme-example: core/14-multisets.vkf -->
```vkf
left: {"a":2, "a":3, "b":1}
right: {"a":2, "c":2}

:: left + right
:: left - {"a":4}
:: left // right
:: left % right
```

<!-- readme-evidence:start core/14-multisets.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
{a:7, b:1, c:2}
{a:1, b:1}
{a:2}
{a:1}
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 55.980 ± 18.847 ms | 1.472 ± 0.037 ms | 1.971 ± 0.272 ms |
| Fresh-process launch + run | 22.718 ± 16.341 ms | 1.521 ± 0.037 ms | 2.201 ± 0.692 ms |

<!-- readme-evidence:end -->

### 2.7 Inclusive Ranges

`start..end` is inclusive. Omitting the start uses zero. Descending ranges infer a negative step. Omitting the end creates an infinite range, which must be stopped by its consumer.

<!-- readme-example: core/15-ranges.vkf -->
```vkf
:: [..3]
:: [3..0]
:: (1..4)
```

<!-- readme-evidence:start core/15-ranges.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[0, 1, 2, 3]
[3, 2, 1, 0]
(1, 2, 3, 4)
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.522 ± 0.431 ms | 0.355 ± 0.031 ms | 0.835 ± 0.162 ms |
| Fresh-process launch + run | 21.878 ± 12.435 ms | 1.522 ± 0.088 ms | 2.100 ± 0.482 ms |

<!-- readme-evidence:end -->

### 2.8 Complex Numbers

`num(real, imaginary)` creates a complex number. Arithmetic, powers, equality, ordering, function arguments, and string conversion are native.

<!-- readme-example: core/16-complex.vkf -->
```vkf
z: num(1, 2)
:: str(z)
:: str(z * z)
```

<!-- readme-evidence:start core/16-complex.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
1 + 2i
-3 + 4i
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 6.032 ± 1.402 ms | 0.423 ± 0.017 ms | 0.971 ± 0.510 ms |
| Fresh-process launch + run | 21.355 ± 7.665 ms | 1.503 ± 0.066 ms | 2.071 ± 0.411 ms |

<!-- readme-evidence:end -->

### 2.9 Equality Has Two Forms

`==` and `!=` reduce exact aggregate equality to one `bit`. Single `=` is semantic and remains element-wise for structures.

<!-- readme-example: core/17-equality.vkf -->
```vkf
:: [1, 2] == [1, 2]
:: [1, 2] != [1, 3]
:: [1, 2] = [1, 2]
```

<!-- readme-evidence:start core/17-equality.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
1
1
[1, 1]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.127 ± 0.519 ms | 0.450 ± 0.015 ms | 0.880 ± 0.120 ms |
| Fresh-process launch + run | 21.495 ± 7.058 ms | 1.490 ± 0.054 ms | 2.083 ± 0.502 ms |

<!-- readme-evidence:end -->

### 2.10 Member Reflection And Spill

Postfix `.` reflects member names and types. Spilling that reflection into `()`, `[]`, or `{}` produces a record, vector, or multiset view. A primitive type may also be spilled into scope.

<!-- readme-example: core/46-member-reflection.vkf -->
```vkf
point: (x:3, y:4)
record_members: (:point.)
vector_members: [:point.]
member_names: {:point.}

:: record_members
:: vector_members
:: member_names
```

<!-- readme-evidence:start core/46-member-reflection.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
(x:int, y:int)
[int, int]
{x:1, y:1}
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 7.027 ± 0.986 ms | 0.599 ± 0.010 ms | 1.182 ± 0.983 ms |
| Fresh-process launch + run | 21.611 ± 3.165 ms | 1.524 ± 0.088 ms | 2.064 ± 0.432 ms |

<!-- readme-evidence:end -->

<!-- readme-example: core/47-primitive-spill.vkf -->
```vkf
:int
:: size(1)
```

<!-- readme-evidence:start core/47-primitive-spill.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
64
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 1.838 ± 0.282 ms | 0.208 ± 0.009 ms | 0.738 ± 0.176 ms |
| Fresh-process launch + run | 21.321 ± 2.935 ms | 1.492 ± 0.083 ms | 1.989 ± 0.321 ms |

<!-- readme-evidence:end -->

## 3. Functions And Calls

### 3.1 Definitions, Results, And Early Return

A function body returns its last row. `@:` returns a value immediately; bare `@` returns `null`.

<!-- readme-example: core/18-functions.vkf -->
```vkf
choose(value:int) -> int:
    value > 0?
        @: 7
    3

do_nothing():
    @

:: choose(1)
:: choose(0)
:: do_nothing()
```

<!-- readme-evidence:start core/18-functions.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
7
3
null
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 5.232 ± 4.510 ms | 0.553 ± 0.012 ms | 0.974 ± 0.160 ms |
| Fresh-process launch + run | 23.395 ± 23.810 ms | 1.489 ± 0.083 ms | 2.104 ± 0.544 ms |

<!-- readme-evidence:end -->

### 3.2 Typed, Default, And Named Arguments

Parameters and results may be typed. Defaults can use earlier parameters. Named arguments bind by name and may be mixed with positional arguments.

<!-- readme-example: core/19-call-arguments.vkf -->
```vkf
weighted(x:num, y:num=x + 1, z:num=y + 1) -> num:
    x * 100 + y * 10 + z

:: weighted(2)
:: weighted(y:4, x:3, z:5)
:: weighted(3, z:5, y:4)
```

<!-- readme-evidence:start core/19-call-arguments.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
234
345
345
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.817 ± 0.651 ms | 0.882 ± 1.885 ms | 1.074 ± 0.220 ms |
| Fresh-process launch + run | 26.960 ± 58.813 ms | 1.498 ± 0.075 ms | 2.147 ± 0.756 ms |

<!-- readme-evidence:end -->

### 3.3 Local Functions, Recursion, And Closures

Functions may be local. Calling a function's own unqualified name is recursion. A returned local function keeps the values it captured from its defining scope.

<!-- readme-example: core/20-recursion-closures.vkf -->
```vkf
factorial(n:int) -> int:
    n <= 1?
        @: 1
    n * factorial(n - 1)

make_offset(offset:num) -> num->num:
    add(value:num) -> num:
        value + offset
    add

add_two: make_offset(2)

:: factorial(6)
:: add_two(5)
```

<!-- readme-evidence:start core/20-recursion-closures.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
720
7
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 4.142 ± 0.611 ms | 0.823 ± 0.012 ms | 1.157 ± 0.161 ms |
| Fresh-process launch + run | 21.892 ± 6.095 ms | 1.499 ± 0.143 ms | 2.094 ± 0.467 ms |

<!-- readme-evidence:end -->

### 3.4 Lambdas And Higher-Order Functions

Functions are values and may be passed to typed function parameters. `(parameters): expression` creates a lambda; it can be called immediately or stored.

<!-- readme-example: core/21-lambdas.vkf -->
```vkf
apply_twice(f:int->int, value:int) -> int:
    f(f(value))

increment(value:int) -> int:
    value + 3

square: (value): value^2

:: apply_twice(increment, 4)
:: square(5)
:: ((value): value + 1)(8)
```

<!-- readme-evidence:start core/21-lambdas.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
10
25
9
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.756 ± 0.497 ms | 0.767 ± 0.011 ms | 1.085 ± 0.142 ms |
| Fresh-process launch + run | 23.755 ± 30.748 ms | 1.524 ± 0.122 ms | 2.127 ± 0.572 ms |

<!-- readme-evidence:end -->

### 3.5 Variadics And Spreads

`...name:type` captures remaining positional arguments. `:::name` captures remaining named arguments. `:value` at a call site spreads a vector, tuple, or record.

<!-- readme-example: core/22-variadics-spreads.vkf -->
```vkf
sum_rest(head:int, ...rest:int) -> int:
    head + stat.sum(rest)

point_sum(x:int, y:int) -> int:
    x + y

capture_named(value:int, :::named):
    named

args: collections.list(2, 3, 4)
point: (y:4, x:3)

:: sum_rest(1, :args)
:: point_sum(:point)
:: capture_named(1, flag:true, mode:"fast")
```

<!-- readme-evidence:start core/22-variadics-spreads.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
10
7
(flag:true, mode:fast)
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 4.685 ± 0.652 ms | 0.962 ± 0.016 ms | 1.296 ± 0.207 ms |
| Fresh-process launch + run | 21.417 ± 2.985 ms | 1.528 ± 0.083 ms | 2.125 ± 0.587 ms |

<!-- readme-evidence:end -->

Empty heterogeneous variadics are valid. Call-site spread keeps owned values and structural shapes.

Spread also flattens fixed values inside tuple and vector literals.

<!-- readme-example: core/22b-literal-spreads.vkf -->
```vkf
values: (:(1, 2), :[3, 4])
:: values
:: values.3
```

<!-- readme-evidence:start core/22b-literal-spreads.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
(1, 2, 3, 4)
4
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.308 ± 0.232 ms | 0.373 ± 0.010 ms | 0.841 ± 0.171 ms |
| Fresh-process launch + run | 21.135 ± 2.782 ms | 1.509 ± 0.086 ms | 2.191 ± 0.723 ms |

<!-- readme-evidence:end -->

### 3.6 Compile-Time Shape Parameters

Lowercase names inside fixed vector sizes are inferred compile-time numbers. Size expressions compose in parameter and result types.

<!-- readme-example: core/23-shape-parameters.vkf -->
```vkf
join(x:[int:n], y:[int:m]) -> [int:n+m]:
    x & y

[int:5] joined: join([1, 2], [3, 4, 5])
:: joined
```

<!-- readme-evidence:start core/23-shape-parameters.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[1, 2, 3, 4, 5]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.386 ± 0.507 ms | 0.608 ± 0.011 ms | 1.082 ± 0.149 ms |
| Fresh-process launch + run | 21.556 ± 3.199 ms | 1.514 ± 0.114 ms | 2.130 ± 0.529 ms |

<!-- readme-evidence:end -->

### 3.7 Open `any` Inference

An `any` parameter may use fields or fixed indices. The compiler infers the required open shape and ignores unrelated record fields.

<!-- readme-example: core/24-open-any.vkf -->
```vkf
read_x(value:any) -> num:
    value.x

sum_pair(value:any) -> num:
    value.0 + value.1

:: read_x((x:2, metadata:"kept"))
:: sum_pair([3, 4])
```

<!-- readme-evidence:start core/24-open-any.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
2
7
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.877 ± 0.332 ms | 0.615 ± 0.012 ms | 0.999 ± 0.144 ms |
| Fresh-process launch + run | 21.388 ± 3.602 ms | 1.491 ± 0.064 ms | 2.117 ± 0.577 ms |

<!-- readme-evidence:end -->

## 4. Automatic Element-Wise Function Application

Structural application is a core language rule, not a special feature of `math` or `+`. Any function can apply recursively across compatible parts of tuples, records, and vectors.

### 4.1 Compatibility Selects Elements

If the whole argument cannot call the function, VKF recursively calls it on compatible elements and preserves incompatible elements unchanged.

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

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.605 ± 0.580 ms | 0.536 ± 0.011 ms | 0.986 ± 0.165 ms |
| Fresh-process launch + run | 21.970 ± 3.301 ms | 1.523 ± 0.059 ms | 2.077 ± 0.390 ms |

<!-- readme-evidence:end -->

The result is `(name:origin, enabled:true, x:4, y:6)`. `str` and `bit` are not compatible with `int`, so metadata survives untouched.

### 4.2 Normal Conversions Still Apply

Compatibility includes legal conversions. `int` can be used as `num`; `str` cannot. If no compatible element exists, the original value is preserved.

<!-- readme-example: core/26-structural-conversions.vkf -->
```vkf
halve(value:num) -> num:
    value / 2

mixed: (name:"sample", whole:8, fraction:3.0)
unchanged: halve((name:"only metadata", enabled:true))

:: halve(mixed)
:: unchanged
```

<!-- readme-evidence:start core/26-structural-conversions.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
(name:sample, whole:4, fraction:1.5)
(name:only metadata, enabled:true)
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 7.004 ± 12.499 ms | 0.624 ± 0.020 ms | 1.069 ± 0.216 ms |
| Fresh-process launch + run | 21.865 ± 3.812 ms | 1.527 ± 0.052 ms | 2.121 ± 0.496 ms |

<!-- readme-evidence:end -->

### 4.3 Application Is Recursive

Structural application descends through nested vectors, tuples, and records. It keeps the original structure while replacing compatible leaves.

<!-- readme-example: core/27-structural-recursion.vkf -->
```vkf
increment(value:int) -> int:
    value + 1

data: [
    (name:"a", point:(x:1, y:2)),
    (name:"b", point:(x:3, y:4))
]

:: increment(data)
```

<!-- readme-evidence:start core/27-structural-recursion.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[(name:a, point:(x:2, y:3)), (name:b, point:(x:4, y:5))]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.923 ± 0.515 ms | 0.641 ± 0.034 ms | 1.099 ± 0.252 ms |
| Fresh-process launch + run | 21.252 ± 3.550 ms | 1.540 ± 0.061 ms | 2.121 ± 0.504 ms |

<!-- readme-evidence:end -->

### 4.4 Structured Functions Map Outer Containers

A function accepting one record maps across a vector of compatible records. A function accepting one row maps across a matrix's rows.

<!-- readme-example: core/28-structural-records.vkf -->
```vkf
translate(point:(x:int,y:int)) -> (x:int,y:int):
    (x:point.x + 10, y:point.y - 10)

row_sum(row:[int]) -> int:
    stat.sum(row)

points: [(x:1, y:2), (x:3, y:4)]
matrix: [[1, 2], [3, 4], [5, 6]]

:: translate(points)
:: row_sum(matrix)
```

<!-- readme-evidence:start core/28-structural-records.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[(x:11, y:-8), (x:13, y:-6)]
[3, 7, 11]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 5.005 ± 0.499 ms | 1.007 ± 0.044 ms | 1.375 ± 0.384 ms |
| Fresh-process launch + run | 21.069 ± 3.044 ms | 1.541 ± 0.078 ms | 2.097 ± 0.468 ms |

<!-- readme-evidence:end -->

### 4.5 Exact Container Matches Take Priority

If the complete argument matches the declared type, VKF calls the function once. It does not descend. Declare the complete container type whenever whole-container behavior is intended.

<!-- readme-example: core/29-structural-exact-match.vkf -->
```vkf
rotate(values:[int:3]) -> [int:3]:
    [values.1, values.2, values.0]

:: rotate([1, 2, 3])
```

<!-- readme-evidence:start core/29-structural-exact-match.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[2, 3, 1]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.467 ± 0.373 ms | 0.466 ± 0.024 ms | 0.960 ± 0.314 ms |
| Fresh-process launch + run | 21.396 ± 3.095 ms | 1.489 ± 0.051 ms | 2.074 ± 0.401 ms |

<!-- readme-evidence:end -->

### 4.6 Math Uses The Same Rule

Math functions use structural application across compatible numeric fields at any depth. This includes `abs`, roots, trigonometry, logs, exponentials, hyperbolic functions, `gamma`, and `erf`.

<!-- readme-example: core/30-math-structural.vkf -->
```vkf
math: .math

data: (
    name:"measurements",
    values:[-1, 4, 9],
    nested:(x:-16, label:"kept"),
)

:: math.abs(data)
:: math.sqrt(data)
```

<!-- readme-evidence:start core/30-math-structural.vkf -->

**Recorded stdout (exit code `0`; stderr empty):**

**Windows x64:**

```text
(name:measurements, values:[1, 4, 9], nested:(x:16, label:kept))
(name:measurements, values:[-1.#IND, 2, 3], nested:(x:-1.#IND, label:kept))
```

**Linux x64:**

```text
(name:measurements, values:[1, 4, 9], nested:(x:16, label:kept))
(name:measurements, values:[-nan, 2, 3], nested:(x:-nan, label:kept))
```

**macOS ARM64:**

```text
(name:measurements, values:[1, 4, 9], nested:(x:16, label:kept))
(name:measurements, values:[nan, 2, 3], nested:(x:nan, label:kept))
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 26.008 ± 2.870 ms | 5.551 ± 0.096 ms | 4.903 ± 0.776 ms |
| Fresh-process launch + run | 21.585 ± 3.062 ms | 1.567 ± 0.063 ms | 2.071 ± 0.415 ms |

<!-- readme-evidence:end -->

## 5. Control Flow And Errors

### 5.1 Conditionals

`condition? expression` runs the expression only when true. An indented suite is allowed. A false conditional expression returns `null`.

<!-- readme-example: core/31-conditionals.vkf -->
```vkf
value: 3
label:
    value > 0?
        1

missing: (false? 99)
:: label
:: missing
```

<!-- readme-evidence:start core/31-conditionals.vkf -->

**Recorded stdout (exit code `0`; stderr empty):**

**Windows x64:**

```text
1
1.#QNAN
```

**Linux x64:**

```text
1
nan
```

**macOS ARM64:**

```text
1
nan
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.968 ± 1.171 ms | 0.392 ± 0.010 ms | 0.895 ± 0.184 ms |
| Fresh-process launch + run | 21.362 ± 2.951 ms | 1.487 ± 0.052 ms | 2.069 ± 0.521 ms |

<!-- readme-evidence:end -->

### 5.2 Match Values And Types

`value??` selects an arm with `=>`. Exact values beat type arms. More specific type, intersection, and shape arms beat broader unions or `any`. The final unlabelled row is the fallback.

<!-- readme-example: core/32-match.vkf -->
```vkf
classify(value:int) -> str:
    value??
        3 => "exact three"
        int => "another integer"
        "fallback"

:: classify(3)
:: classify(4)
```

<!-- readme-evidence:start core/32-match.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
exact three
another integer
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.899 ± 0.387 ms | 0.467 ± 0.011 ms | 0.990 ± 0.216 ms |
| Fresh-process launch + run | 21.701 ± 7.649 ms | 1.473 ± 0.051 ms | 2.075 ± 0.356 ms |

<!-- readme-evidence:end -->

Union and intersection patterns use `|` and `&`. Record, tuple, and fixed-vector shapes may also be patterns.

### 5.3 Conditional And Match Loops

`condition?>` repeats while its condition is true. `value??>` repeatedly matches a changing value.

<!-- readme-example: core/33-loops.vkf -->
```vkf
loop_total() -> int:
    i: 0
    total: 0
    i < 5?>
        .total: total + i
        .i: i + 1
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

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 4.813 ± 0.838 ms | 0.789 ± 0.014 ms | 1.165 ± 0.296 ms |
| Fresh-process launch + run | 21.253 ± 3.134 ms | 1.491 ± 0.061 ms | 2.092 ± 0.418 ms |

<!-- readme-evidence:end -->

### 5.4 Return, Continue, And Break

`@:` returns a value, `@` returns `null`, `@>` continues the nearest loop/pipe, and `@|` breaks it.

The loop in 5.3 demonstrates continue and break. Inside a pipe block, `@:` returns from that element only, not from the enclosing function.

### 5.5 Catching Typed Errors

`Error("message")` constructs an error value; construction alone does not raise.
Postfix `!` raises the value on its left. A bare error type supplies an empty
message, so `Error!` is shorthand for `Error()!`. `expression!?` catches errors
raised by that expression. Arms use `=>`; `$` is the caught error. An unmatched
error continues outward. Only error types and constructed error values may be
raised; `2!` and other ordinary-value raises are compile errors.

<!-- readme-example: core/34-errors.vkf -->
```vkf
: .errors

message: ""
(Error("specific value")!)!?
    Error => .message: $.message

:: message
```

<!-- readme-evidence:start core/34-errors.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
specific value
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 10.813 ± 1.116 ms | 0.864 ± 0.010 ms | 1.487 ± 0.169 ms |
| Fresh-process launch + run | 21.052 ± 3.416 ms | 1.482 ± 0.078 ms | 2.101 ± 0.407 ms |

<!-- readme-evidence:end -->

The exact output is `specific value`. Native errors include the common base
`Error` plus specific types such as `AssertionError`, `IndexError`, and
`ValueError`. Use `errors: .errors` instead when you prefer qualified names such
as `errors.ValueError`.

## 6. Pipes, Ranges, And `$`

### 6.1 Mapping With `>>`

`value >> expression` binds each onward value as `$`. It maps vectors, tuples, dynamic lists, multisets, ranges, and Unicode string characters. A scalar supplies one onward value.

<!-- readme-example: core/35-pipes.vkf -->
```vkf
:: [1, 2, 3] >> $ * 2
:: (1, 2, 3) >> $ + 10
:: 4 >> $^2
:: "åA" >> $ & $
```

<!-- readme-evidence:start core/35-pipes.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[2, 4, 6]
(11, 12, 13)
16
ååAA
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 4.759 ± 0.822 ms | 0.535 ± 0.011 ms | 1.033 ± 0.216 ms |
| Fresh-process launch + run | 21.143 ± 2.790 ms | 1.536 ± 0.068 ms | 2.086 ± 0.425 ms |

<!-- readme-evidence:end -->

Multiset pipes preserve multiplicity. String pipes decode characters from UTF-8 and encode their results back to UTF-8.

### 6.2 Pipe Blocks And Infinite Ranges

A pipe may use a block. `@:` returns that element's result. `@>` skips onward and `@|` stops consumption, including an infinite range.

<!-- readme-example: core/36-pipe-blocks.vkf -->
```vkf
values: (1..) >>
    $ > 4?
        @|
    $ = 2?
        @: 20
    $

:: values
```

<!-- readme-evidence:start core/36-pipe-blocks.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[1, 20, 3, 4]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 7.128 ± 4.302 ms | 0.435 ± 0.011 ms | 0.919 ± 0.143 ms |
| Fresh-process launch + run | 21.092 ± 3.124 ms | 1.509 ± 0.068 ms | 2.082 ± 0.439 ms |

<!-- readme-evidence:end -->

## 7. Operators And Overloads

### 7.1 Built-In Operators

Arithmetic uses `+ - * / // % ^`; concatenation uses `&`. Logic uses `/\ \/ >< ~`. Ordering uses `< <= > >=`; equality uses `= == !=`.

<!-- readme-example: core/37-operators.vkf -->
```vkf
:: 2 + 3 * 4
:: 17 // 5
:: 17 % 5
:: 2^8
:: (1 /\ 0) \/ (1 >< 0)
:: ~(2 > 3)
```

<!-- readme-evidence:start core/37-operators.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
14
3
2
256
true
true
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.419 ± 0.600 ms | 0.548 ± 0.011 ms | 0.950 ± 0.181 ms |
| Fresh-process launch + run | 21.059 ± 3.029 ms | 1.511 ± 0.076 ms | 2.013 ± 0.280 ms |

<!-- readme-evidence:end -->

`/\` and `\/` short-circuit. Power binds more tightly than multiplication. Unary `-` and `~` are supported.

### 7.2 Absolute Value And Vector Norm

`|value|` is absolute value for a scalar and Euclidean norm for a numeric vector.

<!-- readme-example: core/38-absolute-norm.vkf -->
```vkf
:: |-5|
:: |[3, 4]|
```

<!-- readme-evidence:start core/38-absolute-norm.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
5
5
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 1.797 ± 0.320 ms | 0.222 ± 0.010 ms | 0.746 ± 0.205 ms |
| Fresh-process launch + run | 22.159 ± 8.071 ms | 1.482 ± 0.059 ms | 2.037 ± 0.352 ms |

<!-- readme-evidence:end -->

### 7.3 Operator Overloads

Define an operator like a function with custom parameter types. Unary operators and dotted field/index access may also be overloaded.

<!-- readme-example: core/39-overloads.vkf -->
```vkf
Point: (x:num, y:num)

+(a:Point, b:Point) -> Point:
    (x:a.x + b.x, y:a.y + b.y)

-(value:Point) -> Point:
    (x:-value.x, y:-value.y)

:: (x:1, y:2) + (x:3, y:4)
:: -(x:3, y:4)
```

<!-- readme-evidence:start core/39-overloads.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
(x:4, y:6)
(x:-3, y:-4)
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.845 ± 0.658 ms | 0.816 ± 0.009 ms | 1.190 ± 0.268 ms |
| Fresh-process launch + run | 21.156 ± 3.455 ms | 1.527 ± 0.132 ms | 2.005 ± 0.330 ms |

<!-- readme-evidence:end -->

Overloading `str(custom)` controls conversion and interpolation. Overloading `::(custom)` controls direct output.

### 7.4 Dotted Access Overloads

Overload `.` to interpret custom field and dotted-index names. Normal record fields remain available inside the overload.

<!-- readme-example: core/48-dot-overload.vkf -->
```vkf
Pair: (x:num, y:num)

.(pair:Pair, key:str) -> num:
    key = "left"? @: pair.x
    key = "right"? @: pair.y
    @: 0

Pair pair: (x:3, y:4)
:: pair.left
:: pair.("right")
```

<!-- readme-evidence:start core/48-dot-overload.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
3
4
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.547 ± 0.405 ms | 0.639 ± 0.012 ms | 1.598 ± 4.816 ms |
| Fresh-process launch + run | 21.412 ± 3.196 ms | 1.484 ± 0.078 ms | 2.034 ± 0.419 ms |

<!-- readme-evidence:end -->

## 8. Shapes, Axes, And Indexing

### 8.1 Fixed Shapes

Fixed vector shapes nest, survive calls, and compose through compile-time size expressions. Dynamic vectors use `[T]` and expose runtime storage.

<!-- readme-example: core/40-fixed-shapes.vkf -->
```vkf
cross(matrix:[[int:2]:2]) -> int:
    matrix.(0).(1) + matrix.(1).(0)

:: cross([[1, 2], [3, 4]])
```

<!-- readme-evidence:start core/40-fixed-shapes.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
5
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.587 ± 0.386 ms | 0.519 ± 0.010 ms | 0.943 ± 0.200 ms |
| Fresh-process launch + run | 21.776 ± 3.880 ms | 1.406 ± 0.151 ms | 2.017 ± 0.374 ms |

<!-- readme-evidence:end -->

### 8.2 Single And Multi-Index Access

Use `.index` for a fixed literal index and `.(expression)` for runtime or multiple indices. The same syntax followed by `:` updates selected positions.

<!-- readme-example: core/41-indexing.vkf -->
```vkf
values: [10, 20, 30, 40]
:: values.1
:: values.(0, 2)

values.(1, 3): (21, 41)
:: values
```

<!-- readme-evidence:start core/41-indexing.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
20
[10, 30]
[10, 21, 30, 41]
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 2.900 ± 0.458 ms | 0.465 ± 0.011 ms | 0.957 ± 0.261 ms |
| Fresh-process launch + run | 21.507 ± 3.833 ms | 1.537 ± 0.185 ms | 2.043 ± 0.484 ms |

<!-- readme-evidence:end -->

Out-of-range dynamic indexing raises `errors.IndexError`.

### 8.3 Axis Tags And Tensor Products

`->axis` gives a vector a named axis. Matching axes compute element-wise. Distinct axes form an outer product and preserve tensor rank.

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

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 5.329 ± 0.673 ms | 0.853 ± 0.013 ms | 1.220 ± 0.295 ms |
| Fresh-process launch + run | 21.352 ± 3.376 ms | 1.597 ± 0.192 ms | 2.040 ± 0.492 ms |

<!-- readme-evidence:end -->

The first result is a `3 x 3` matrix on axes `i,j`; the second remains a length-three vector on `i`; the third is rank three.

## 9. Modules, Scope, And Dispatch

### 9.1 Module Handles And Imports

`.name` is a module handle. Bind it to an alias or spill it with `:.name`. Local `.vkf` modules use the same import model and are fingerprinted as build dependencies.

<!-- readme-example: core/43-modules.vkf -->
```vkf
m: .math
:: m.sqrt(9)

:.math
:: sin(pi / 2)
```

<!-- readme-evidence:start core/43-modules.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
3
1
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 47.290 ± 5.419 ms | 10.228 ± 0.106 ms | 8.381 ± 1.080 ms |
| Fresh-process launch + run | 21.072 ± 3.431 ms | 1.511 ± 0.111 ms | 2.052 ± 0.411 ms |

<!-- readme-evidence:end -->

### 9.2 Shadowing And Qualification

Local names shadow outer value layouts and unbound builtin module names. A bound module alias qualifies the library explicitly, which is also how a function avoids accidentally calling itself.

<!-- readme-example: core/44-shadowing.vkf -->
```vkf
m: .math

sin(value:num) -> num:
    m.sin(value)

values: [10, 20, 30]

local() -> int:
    values: 3
    values + 1

:: sin(0)
:: local()
```

<!-- readme-evidence:start core/44-shadowing.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
0
4
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 24.060 ± 3.216 ms | 5.504 ± 0.041 ms | 4.753 ± 0.496 ms |
| Fresh-process launch + run | 21.225 ± 3.238 ms | 1.497 ± 0.104 ms | 2.065 ± 0.478 ms |

<!-- readme-evidence:end -->

### 9.3 Overload Families And Type Dispatch

Multiple functions with the same name form an overload family selected by parameter compatibility. Match arms use the same type-specificity rules.

<!-- readme-example: core/45-overloads-dispatch.vkf -->
```vkf
describe(value:int) -> str:
    "integer"

describe(value:str) -> str:
    "text"

:: describe(3)
:: describe("three")
```

<!-- readme-evidence:start core/45-overloads-dispatch.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
integer
text
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 6.358 ± 5.330 ms | 0.462 ± 0.012 ms | 1.921 ± 9.734 ms |
| Fresh-process launch + run | 21.772 ± 3.549 ms | 1.469 ± 0.134 ms | 2.069 ± 0.492 ms |

<!-- readme-evidence:end -->

## 10. Native Standard Library

These modules are part of the native 0.1.5 release on Windows x64, Linux x64, and macOS ARM64.

### 10.1 `math`

Constants: `pi`, `e`, `tau`.

Functions: `abs`, `sqrt`, `sin`, `cos`, `tan`, `sec`, `cot`, `csc`, `asin`, `acos`, `atan`, `atan2`, `acot`, `asec`, `acsc`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `exp`, `ln`, `lg`, `lg2`, `log`, `gamma`, `erf`.

<!-- readme-example: stdlib/01-math.vkf -->
```vkf
math: .math
:: math.sqrt(81)
:: math.sin(math.pi / 2)
:: math.log(8, 2)
```

<!-- readme-evidence:start stdlib/01-math.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
9
1
3
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 23.963 ± 2.733 ms | 5.428 ± 0.074 ms | 4.759 ± 0.538 ms |
| Fresh-process launch + run | 21.270 ± 3.461 ms | 1.526 ± 0.178 ms | 2.051 ± 0.582 ms |

<!-- readme-evidence:end -->

All compatible unary math functions use the structural rule in section 4.

### 10.2 `stat`

Functions include `sum`, `mean`, `count`, `min`, `max`, `range`, `variance`, `std`, `percentile`, `median`, `iqr`, `mode`, `zscore`, `normalize`, `covariance`, `correlation`, `clamp`, and `sign`.

<!-- readme-example: stdlib/02-stat.vkf -->
```vkf
values: [2, 4, 4, 4, 5, 5, 7, 9]
:: stat.mean(values)
:: stat.variance(values)
:: stat.std(values)
:: stat.range(values)
```

<!-- readme-evidence:start stdlib/02-stat.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
5
4
2
7
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 3.774 ± 0.702 ms | 0.556 ± 0.020 ms | 1.004 ± 0.256 ms |
| Fresh-process launch + run | 21.518 ± 7.565 ms | 1.493 ± 0.103 ms | 2.100 ± 0.623 ms |

<!-- readme-evidence:end -->

`variance` and `std` accept `ddof`; zero is the population form and one is the sample form.

### 10.3 `random`

`next`, `uniform`, and `normal` are explicit-seed functions returning `(value, seed)`. `clock_seed` creates a time-based seed. Explicit state makes deterministic sequences easy to reproduce.

<!-- readme-example: stdlib/03-random.vkf -->
```vkf
random: .random
first: random.uniform(123, low:0, high:10)
second: random.uniform(first.seed, low:0, high:10)
:: first.value
:: second.value
```

<!-- readme-evidence:start stdlib/03-random.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
0.009626434189093501
1.791479416094478
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 8.518 ± 1.641 ms | 1.988 ± 0.016 ms | 2.186 ± 0.468 ms |
| Fresh-process launch + run | 21.224 ± 3.030 ms | 1.487 ± 0.069 ms | 2.092 ± 0.584 ms |

<!-- readme-evidence:end -->

### 10.4 `time`

`wall_time`, `monotonic`, `sleep`, `time_stamp`, `format_time`, and `current_time` are native. Formatting accepts UTC selection and percent directives.

<!-- readme-example: stdlib/04-time.vkf -->
```vkf
time: .time
before: time.monotonic()
after: time.monotonic()
(time.wall_time() > 1700000000)?!
(after >= before)?!
:: time.format_time(0, "%Y-%m-%d %H:%M:%S", utc:true)
```

<!-- readme-evidence:start stdlib/04-time.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
1970-01-01 00:00:00
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 50.353 ± 3.525 ms | 8.113 ± 1.471 ms | 7.194 ± 0.503 ms |
| Fresh-process launch + run | 21.657 ± 2.636 ms | 1.588 ± 0.097 ms | 2.629 ± 0.629 ms |

<!-- readme-evidence:end -->

### 10.5 `io`

`print`, `eprint`, `read_line`, `read_text`, `read_bytes`, `write_text`, `write_bytes`, and `append_text` perform native stream and file I/O.

<!-- readme-example: stdlib/05-io.vkf -->
```vkf
io: .io
io.write_text("vkf-example.txt", "hello")
io.append_text("vkf-example.txt", " world")
:: io.read_text("vkf-example.txt")
```

<!-- readme-evidence:start stdlib/05-io.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
hello world
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 15.836 ± 9.724 ms | 0.959 ± 0.010 ms | 1.657 ± 0.219 ms |
| Fresh-process launch + run | 21.572 ± 2.753 ms | 1.599 ± 0.127 ms | 2.555 ± 0.679 ms |

<!-- readme-evidence:end -->

File operations use the current user's permissions. Paths are not sandboxed.

### 10.6 `collections`

`list` creates a dynamic list, `map` creates an extensible named record, and `queue` creates a FIFO queue with `put`, `get`, and `empty`.

<!-- readme-example: stdlib/06-collections.vkf -->
```vkf
collections: .collections
values: collections.list(1, 2, 3)
point: collections.map(name:"origin", x:1, y:2)
queue: collections.queue()
queue.put(10)

:: values
:: point.name
:: queue.get()
:: queue.empty()
```

<!-- readme-evidence:start stdlib/06-collections.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[1, 2, 3]
origin
10
true
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 9.868 ± 1.088 ms | 1.255 ± 0.012 ms | 1.662 ± 0.266 ms |
| Fresh-process launch + run | 20.852 ± 2.630 ms | 1.539 ± 0.121 ms | 2.198 ± 0.682 ms |

<!-- readme-evidence:end -->

An empty queue returns `null` from `get`.

### 10.7 `errors`

The module exposes typed errors for the `!?` mechanism, including `Error`, `AssertionError`, `IndexError`, and `ValueError`.

<!-- readme-example: stdlib/07-errors.vkf -->
```vkf
errors: .errors
caught: false
int(1.5)!?
    errors.ValueError => .caught: true
:: caught
```

<!-- readme-evidence:start stdlib/07-errors.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
true
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 10.638 ± 1.004 ms | 0.827 ± 0.012 ms | 1.471 ± 0.190 ms |
| Fresh-process launch + run | 20.818 ± 2.770 ms | 1.484 ± 0.058 ms | 2.111 ± 0.506 ms |

<!-- readme-evidence:end -->

### 10.8 `system`

`os`, `arch`, `cpu_count`, `cwd`, and `env` expose narrow host information. `env` returns `(found, value)` instead of confusing a missing variable with an empty value.

<!-- readme-example: stdlib/08-system.vkf -->
```vkf
system: .system
path: system.env("PATH")
:: system.os()
:: system.arch()
:: system.cpu_count()
:: system.cwd()
:: path.found
```

<!-- readme-evidence:start stdlib/08-system.vkf -->

**Recorded stdout (exit code `0`; stderr empty):**

**Windows x64:**

```text
windows
x86_64
4
C:\Users\RUNNER~1\AppData\Local\Temp\vkf-readme-proof-TCUWrM\runtime\stdlib\08-system
true
```

**Linux x64:**

```text
linux
x86_64
4
/tmp/vkf-readme-proof-wuMZ7S/runtime/stdlib/08-system
true
```

**macOS ARM64:**

```text
macos
arm64
3
/private/var/folders/_5/zjnzxgh147qcg3bb5cg2wvqw0000gn/T/vkf-readme-proof-xUCBDs/runtime/stdlib/08-system
true
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 4.671 ± 0.519 ms | 0.950 ± 0.014 ms | 1.368 ± 0.152 ms |
| Fresh-process launch + run | 21.108 ± 3.003 ms | 1.530 ± 0.041 ms | 2.172 ± 0.770 ms |

<!-- readme-evidence:end -->

There is no portable raw-syscall function in the stable library.

### 10.9 `process`

`run(program, args)` launches a program directly and returns `(code, out, err)`. `shell(command)` deliberately invokes the platform shell.

<!-- readme-example: stdlib/09-process.vkf -->
```vkf
process: .process
result: process.run("git", ["--version"])
:: result.code
:: result.out
:: result.err
```

<!-- readme-evidence:start stdlib/09-process.vkf -->

**Recorded stdout (exit code `0`; stderr empty):**

**Windows x64:**

```text
0
git version 2.55.0.windows.4


```

**Linux x64:**

```text
0
git version 2.55.0


```

**macOS ARM64:**

```text
0
git version 2.55.0


```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 4.288 ± 0.616 ms | 0.767 ± 0.012 ms | 1.213 ± 0.141 ms |
| Fresh-process launch + run | 54.860 ± 6.496 ms | 2.800 ± 0.051 ms | 8.119 ± 1.471 ms |

<!-- readme-evidence:end -->

Use `run` for ordinary commands. It keeps arguments separate and avoids shell interpolation. Use `shell` only when shell syntax is genuinely required, and never insert untrusted text into its command.

### 10.10 `regex`

`regex.match(source, pattern)` returns a record of named captures. `regex.groups(source, pattern)` returns positional captures as a tuple. Patterns are compile-time constants in the portable byte-pattern grammar.

<!-- readme-example: stdlib/10-regex.vkf -->
```vkf
regex: .regex
named: regex.match("vektor", '^(?P<word>[a-z]+)$')
positional: regex.groups("vkf-101", '([a-z]+)-([0-9]+)')
:: named.word
:: positional.0
:: positional.1
```

<!-- readme-evidence:start stdlib/10-regex.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
vektor
vkf
101
```

| Measured latency, 100 runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Fresh executable build | 5.858 ± 0.676 ms | 0.783 ± 0.014 ms | 1.260 ± 0.200 ms |
| Fresh-process launch + run | 20.938 ± 2.552 ms | 1.504 ± 0.073 ms | 2.327 ± 0.438 ms |

<!-- readme-evidence:end -->

## 11. Coming Soon

The following areas are planned, but unavailable in the native 0.1.5 release. Their repository prototypes and legacy examples are not part of the supported compiler surface.

### 11.1 Native `ui`

The visual and scene system is not in the native 0.1.5 compiler. Older repository examples may run through legacy tooling, but they are not evidence of the released native language.

### 11.2 Native `physics`

Rigid-body work belongs under `physics`, but the module is partial and excluded from 0.1.5. No `rigid_body` compatibility module ships in the release.

### 11.3 Native `symbolic`

Symbolic domains, relations, transformations, solving, calculus, and symbolic UI inspection remain experimental. They are excluded from 0.1.5 and must not be presented as native core features.

The same rule applies to every future feature: it enters the numbered native guide only after parsing, lowering, executable generation, runtime behavior, and native `vkf -t` verification pass on the release targets.

## Development

The native compiler is under `compiler/native`. The self-hosted standard-library sources are under `compiler/self_hosted/stdlib`.

Compiler, runtime, standard-library, packaging, and test paths contain and
invoke no Python. Cross-language benchmark fixtures are isolated under
`benchmarks/core-comparison` and never participate in those paths.

The runnable guide examples are committed under `examples/generated/readme` and
verified by the native release workflow.

The 0.1.5 acceptance suite is run by VKF itself:

```bash
vkf -t tests/vkf
```

The expected result is `309 passed, 0 failed`. Physics, UI, and symbolic fixtures live outside this release directory. Run the additional native build and standard-library proofs in the [testing guide](/testing). Build and packaging details are in the [installation guide](/install), and release procedures are in [RELEASES.md](https://github.com/svenviktorjonsson/vektor-flow/blob/main/RELEASES.md).

VS Code syntax support is under [`vscode/`](https://github.com/svenviktorjonsson/vektor-flow/blob/main/vscode/README.md).

## Status

VKF 0.1.5 is a deliberately incomplete native preview. Use GitHub Issues for reproducible compiler, installer, documentation, and safety problems.
