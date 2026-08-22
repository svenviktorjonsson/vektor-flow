# Vektor Flow Language Guide

**Designed by Viktor Jonsson.**

Vektor Flow (VKF) is an experimental, scope-based language for compact native programs, structured data, mathematics, and eventually visual applications.

Its central ideas are bindings that build scope, blocks that return values, callable types, structural operations, and functions that automatically apply across compatible elements.

> [!WARNING]
> VKF 0.1.4 is an experimental preview, not a supported production language. It has bugs, incomplete diagnostics, and unstable APIs and syntax.
>
> The visual system is intended to become VKF's strongest feature, but `ui`, `physics`, and `symbolic` are not included in the native 0.1.4 release.

## Release History

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

## Download And Run VKF 0.1.4

Download VKF from the [0.1.4 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.4).

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

Compilation includes source reading, lexing, parsing, native standard-library
resolution, typed IR, machine lowering, and executable emission. It uses one
persistent compiler process, so the per-example compile measurement excludes
compiler-process startup. Runtime deliberately includes executable loading,
process startup, program work, output capture, and teardown.

These are the machines and conditions behind every inline table:

<!-- readme-platform-evidence:start -->
| Detail | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Measured UTC | `2026-08-22T17:16:31.807Z` | `2026-08-22T17:13:31.491Z` | `2026-08-22T17:13:09.354Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | AMD EPYC 7763 64-Core Processor | Intel(R) Xeon(R) 6973P-C | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 3,744,256 bytes | 4,890,784 bytes | 2,205,816 bytes |
| Compiler SHA-256 | `addac74ba2aebee69e4a31a2ddfff1cd8ec137603529c3c0970e97863941a082` | `7e3a0dd0f5a4d48a1ec48473318b5c37812c7a847954b28bbcbaf5d9810f4b74` | `c05c4ea9ce389ef73584e6b77783d0c1e942c62fd1bc1a85ff14ff56c7d7c6d0` |
| Timing host | v22.23.2 `Node performance.now()` | v22.23.2 `Node performance.now()` | v22.23.1 `Node performance.now()` |
<!-- readme-platform-evidence:end -->

The dedicated `core/12b-container-stress.vkf` example always performs 10
million fixed-container element updates and reads, then prints only the
checksum. Its work count is never adjusted to target a preferred duration.

### Native 0.1.4 Scope

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.281 ± 0.189 ms | 0.271 ± 0.011 ms | 0.894 ± 0.638 ms |
| Runtime | 17.756 ± 0.708 ms | 1.189 ± 0.043 ms | 1.854 ± 0.472 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 1.926 ± 0.128 ms | 0.187 ± 0.008 ms | 1.022 ± 2.641 ms |
| Runtime | 17.862 ± 1.393 ms | 1.191 ± 0.033 ms | 1.822 ± 0.403 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 15.255 ± 44.027 ms | 0.702 ± 0.016 ms | 1.265 ± 0.379 ms |
| Runtime | 17.588 ± 0.854 ms | 1.216 ± 0.045 ms | 1.843 ± 0.464 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.035 ± 0.155 ms | 0.223 ± 0.008 ms | 0.833 ± 0.497 ms |
| Runtime | 17.694 ± 0.860 ms | 1.186 ± 0.042 ms | 1.844 ± 0.437 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 1.871 ± 0.098 ms | 0.231 ± 0.010 ms | 0.835 ± 0.579 ms |
| Runtime | 17.500 ± 0.571 ms | 1.187 ± 0.039 ms | 1.774 ± 0.408 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.633 ± 0.217 ms | 0.485 ± 0.012 ms | 1.262 ± 2.208 ms |
| Runtime | 17.606 ± 0.662 ms | 1.199 ± 0.048 ms | 1.754 ± 0.282 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.885 ± 0.418 ms | 0.350 ± 0.011 ms | 1.033 ± 1.138 ms |
| Runtime | 17.665 ± 0.676 ms | 1.197 ± 0.045 ms | 1.752 ± 0.292 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.937 ± 0.374 ms | 0.437 ± 0.015 ms | 0.966 ± 0.228 ms |
| Runtime | 17.714 ± 0.844 ms | 1.197 ± 0.036 ms | 1.766 ± 0.331 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.035 ± 0.905 ms | 0.425 ± 0.011 ms | 0.990 ± 0.184 ms |
| Runtime | 17.919 ± 0.937 ms | 1.193 ± 0.044 ms | 1.826 ± 0.517 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.833 ± 0.596 ms | 0.370 ± 0.012 ms | 0.946 ± 0.255 ms |
| Runtime | 17.863 ± 0.876 ms | 1.206 ± 0.061 ms | 1.801 ± 0.447 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.302 ± 0.157 ms | 0.359 ± 0.011 ms | 0.920 ± 0.182 ms |
| Runtime | 17.990 ± 1.017 ms | 1.196 ± 0.046 ms | 1.788 ± 0.409 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 5.024 ± 0.156 ms | 0.669 ± 0.015 ms | 1.139 ± 0.157 ms |
| Runtime | 49.291 ± 1.843 ms | 18.213 ± 0.080 ms | 41.983 ± 4.333 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 5.508 ± 0.179 ms | 0.679 ± 0.022 ms | 1.147 ± 0.187 ms |
| Runtime | 18.446 ± 0.818 ms | 1.232 ± 0.032 ms | 2.176 ± 0.422 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 54.502 ± 1.629 ms | 0.911 ± 0.030 ms | 1.888 ± 0.375 ms |
| Runtime | 17.817 ± 0.756 ms | 1.207 ± 0.044 ms | 1.855 ± 0.283 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.219 ± 0.114 ms | 0.256 ± 0.013 ms | 0.800 ± 0.188 ms |
| Runtime | 17.796 ± 0.860 ms | 1.199 ± 0.035 ms | 1.866 ± 0.452 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 5.684 ± 0.169 ms | 0.320 ± 0.016 ms | 0.907 ± 0.239 ms |
| Runtime | 17.799 ± 0.936 ms | 1.178 ± 0.039 ms | 1.869 ± 0.441 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.887 ± 0.188 ms | 0.294 ± 0.018 ms | 0.841 ± 0.156 ms |
| Runtime | 17.716 ± 0.839 ms | 1.177 ± 0.042 ms | 1.854 ± 0.375 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 7.058 ± 0.475 ms | 0.452 ± 0.013 ms | 1.012 ± 0.226 ms |
| Runtime | 17.923 ± 0.876 ms | 1.193 ± 0.039 ms | 2.807 ± 0.856 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 1.718 ± 0.169 ms | 0.134 ± 0.008 ms | 0.713 ± 0.192 ms |
| Runtime | 17.794 ± 0.773 ms | 1.179 ± 0.039 ms | 2.869 ± 1.097 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 11.878 ± 36.791 ms | 0.395 ± 0.023 ms | 0.901 ± 0.151 ms |
| Runtime | 17.561 ± 0.587 ms | 1.177 ± 0.040 ms | 1.877 ± 0.504 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.317 ± 0.339 ms | 0.485 ± 0.027 ms | 0.999 ± 0.182 ms |
| Runtime | 17.667 ± 0.776 ms | 1.181 ± 0.049 ms | 1.901 ± 0.569 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.539 ± 0.378 ms | 0.620 ± 0.034 ms | 1.067 ± 0.157 ms |
| Runtime | 17.738 ± 0.584 ms | 1.185 ± 0.049 ms | 1.874 ± 0.529 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.384 ± 1.261 ms | 0.555 ± 0.025 ms | 1.030 ± 0.185 ms |
| Runtime | 17.560 ± 0.625 ms | 1.203 ± 0.102 ms | 1.832 ± 0.450 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 4.125 ± 0.409 ms | 0.717 ± 0.018 ms | 1.173 ± 0.150 ms |
| Runtime | 17.825 ± 0.712 ms | 1.203 ± 0.045 ms | 1.810 ± 0.401 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.164 ± 0.098 ms | 0.272 ± 0.011 ms | 0.776 ± 0.119 ms |
| Runtime | 17.760 ± 0.658 ms | 1.195 ± 0.041 ms | 1.866 ± 0.564 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.269 ± 0.232 ms | 0.481 ± 0.014 ms | 0.989 ± 0.128 ms |
| Runtime | 17.779 ± 0.657 ms | 1.190 ± 0.043 ms | 1.888 ± 0.830 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.605 ± 0.215 ms | 0.452 ± 0.018 ms | 0.914 ± 0.120 ms |
| Runtime | 17.615 ± 0.630 ms | 1.177 ± 0.046 ms | 1.874 ± 0.735 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.453 ± 0.240 ms | 0.404 ± 0.014 ms | 0.907 ± 0.115 ms |
| Runtime | 17.820 ± 0.822 ms | 1.214 ± 0.051 ms | 1.929 ± 1.196 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 9.976 ± 26.295 ms | 0.458 ± 0.014 ms | 0.984 ± 0.189 ms |
| Runtime | 17.834 ± 0.823 ms | 1.220 ± 0.051 ms | 1.901 ± 0.855 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.768 ± 0.189 ms | 0.474 ± 0.015 ms | 1.013 ± 0.164 ms |
| Runtime | 17.851 ± 0.816 ms | 1.221 ± 0.046 ms | 1.881 ± 0.669 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 4.600 ± 0.391 ms | 0.763 ± 0.014 ms | 1.271 ± 0.508 ms |
| Runtime | 17.899 ± 0.906 ms | 1.207 ± 0.049 ms | 1.907 ± 0.633 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.233 ± 0.171 ms | 0.349 ± 0.012 ms | 1.448 ± 3.774 ms |
| Runtime | 18.057 ± 1.020 ms | 1.205 ± 0.047 ms | 1.987 ± 0.843 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 20.024 ± 1.392 ms | 3.452 ± 0.024 ms | 8.716 ± 9.939 ms |
| Runtime | 17.711 ± 0.756 ms | 1.255 ± 0.085 ms | 2.195 ± 2.291 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.596 ± 0.409 ms | 0.316 ± 0.013 ms | 1.601 ± 3.355 ms |
| Runtime | 17.521 ± 0.734 ms | 1.183 ± 0.040 ms | 2.012 ± 0.735 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.616 ± 0.305 ms | 0.354 ± 0.016 ms | 1.597 ± 3.163 ms |
| Runtime | 17.562 ± 0.651 ms | 1.180 ± 0.047 ms | 2.100 ± 0.909 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 4.157 ± 0.442 ms | 0.561 ± 0.012 ms | 2.246 ± 5.421 ms |
| Runtime | 17.594 ± 0.734 ms | 1.187 ± 0.042 ms | 2.122 ± 0.818 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 11.732 ± 0.584 ms | 0.647 ± 0.014 ms | 1.693 ± 2.647 ms |
| Runtime | 17.546 ± 0.711 ms | 1.184 ± 0.047 ms | 2.177 ± 0.903 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 4.395 ± 0.233 ms | 0.386 ± 0.018 ms | 2.084 ± 6.015 ms |
| Runtime | 17.658 ± 0.776 ms | 1.202 ± 0.038 ms | 2.572 ± 3.131 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 12.073 ± 36.177 ms | 0.317 ± 0.015 ms | 1.878 ± 5.297 ms |
| Runtime | 17.775 ± 1.299 ms | 1.200 ± 0.053 ms | 2.316 ± 0.894 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.964 ± 0.134 ms | 0.344 ± 0.011 ms | 2.355 ± 5.658 ms |
| Runtime | 17.839 ± 1.012 ms | 1.196 ± 0.046 ms | 2.556 ± 1.671 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 1.714 ± 0.055 ms | 0.139 ± 0.009 ms | 4.038 ± 8.427 ms |
| Runtime | 17.939 ± 0.944 ms | 1.184 ± 0.045 ms | 2.501 ± 1.348 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.335 ± 0.172 ms | 0.575 ± 0.012 ms | 1.707 ± 2.933 ms |
| Runtime | 17.949 ± 1.008 ms | 1.201 ± 0.046 ms | 2.433 ± 0.933 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.276 ± 0.414 ms | 0.471 ± 0.015 ms | 1.047 ± 0.279 ms |
| Runtime | 17.668 ± 0.693 ms | 1.181 ± 0.054 ms | 2.848 ± 0.892 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.333 ± 0.333 ms | 0.373 ± 0.012 ms | 1.047 ± 1.350 ms |
| Runtime | 17.972 ± 0.916 ms | 1.136 ± 0.042 ms | 2.424 ± 0.858 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 2.777 ± 0.195 ms | 0.325 ± 0.010 ms | 1.768 ± 4.943 ms |
| Runtime | 18.002 ± 1.074 ms | 1.201 ± 0.046 ms | 2.526 ± 0.916 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 5.194 ± 0.224 ms | 0.608 ± 0.013 ms | 2.310 ± 5.546 ms |
| Runtime | 17.984 ± 0.936 ms | 1.235 ± 0.036 ms | 2.627 ± 0.915 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 33.355 ± 1.241 ms | 6.383 ± 0.046 ms | 8.108 ± 3.660 ms |
| Runtime | 17.757 ± 0.828 ms | 1.191 ± 0.045 ms | 2.978 ± 1.982 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 17.504 ± 1.181 ms | 3.426 ± 0.034 ms | 4.738 ± 3.480 ms |
| Runtime | 17.798 ± 0.754 ms | 1.179 ± 0.043 ms | 2.867 ± 1.089 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 10.053 ± 20.553 ms | 0.372 ± 0.013 ms | 0.912 ± 0.226 ms |
| Runtime | 18.004 ± 1.040 ms | 1.169 ± 0.054 ms | 2.932 ± 1.407 ms |

<!-- readme-evidence:end -->

## 10. Native Standard Library

These modules are part of the native 0.1.4 release on Windows x64, Linux x64, and macOS ARM64.

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 18.063 ± 1.567 ms | 3.345 ± 0.026 ms | 4.270 ± 0.563 ms |
| Runtime | 17.674 ± 0.663 ms | 1.190 ± 0.045 ms | 2.862 ± 0.978 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.288 ± 0.295 ms | 0.414 ± 0.012 ms | 1.461 ± 3.848 ms |
| Runtime | 18.500 ± 8.854 ms | 1.176 ± 0.039 ms | 2.808 ± 0.727 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 6.965 ± 0.579 ms | 1.374 ± 0.013 ms | 1.964 ± 0.315 ms |
| Runtime | 17.604 ± 1.070 ms | 1.185 ± 0.050 ms | 3.015 ± 1.010 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 47.954 ± 26.990 ms | 5.425 ± 0.076 ms | 6.413 ± 0.579 ms |
| Runtime | 18.428 ± 1.071 ms | 1.231 ± 0.048 ms | 3.429 ± 1.008 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 28.865 ± 76.414 ms | 0.748 ± 0.015 ms | 1.513 ± 0.277 ms |
| Runtime | 18.521 ± 1.041 ms | 1.239 ± 0.055 ms | 3.352 ± 1.141 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 9.797 ± 0.594 ms | 0.912 ± 0.010 ms | 1.504 ± 0.285 ms |
| Runtime | 17.730 ± 0.716 ms | 1.198 ± 0.047 ms | 2.862 ± 0.724 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 11.650 ± 1.353 ms | 0.628 ± 0.012 ms | 1.384 ± 0.314 ms |
| Runtime | 17.562 ± 0.643 ms | 1.184 ± 0.042 ms | 2.809 ± 1.430 ms |

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
C:\Users\RUNNER~1\AppData\Local\Temp\vkf-readme-proof-yGIQ8z\runtime\stdlib\08-system
true
```

**Linux x64:**

```text
linux
x86_64
4
/tmp/vkf-readme-proof-vDvMLO/runtime/stdlib/08-system
true
```

**macOS ARM64:**

```text
macos
arm64
3
/private/var/folders/_5/zjnzxgh147qcg3bb5cg2wvqw0000gn/T/vkf-readme-proof-CGG9d4/runtime/stdlib/08-system
true
```

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 4.194 ± 0.979 ms | 0.662 ± 0.011 ms | 1.277 ± 0.331 ms |
| Runtime | 17.521 ± 0.671 ms | 1.224 ± 0.049 ms | 2.526 ± 0.949 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.877 ± 0.386 ms | 0.620 ± 0.726 ms | 1.146 ± 0.228 ms |
| Runtime | 46.525 ± 2.088 ms | 2.083 ± 0.043 ms | 8.596 ± 3.219 ms |

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

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 5.852 ± 0.307 ms | 0.565 ± 0.013 ms | 1.188 ± 0.239 ms |
| Runtime | 18.217 ± 0.787 ms | 1.195 ± 0.037 ms | 1.997 ± 0.387 ms |

<!-- readme-evidence:end -->

## 11. Coming Soon

The following areas are planned, but unavailable in the native 0.1.4 release. Their repository prototypes and legacy examples are not part of the supported compiler surface.

### 11.1 Native `ui`

The visual and scene system is not in the native 0.1.4 compiler. Older repository examples may run through legacy tooling, but they are not evidence of the released native language.

### 11.2 Native `physics`

Rigid-body work belongs under `physics`, but the module is partial and excluded from 0.1.4. No `rigid_body` compatibility module ships in the release.

### 11.3 Native `symbolic`

Symbolic domains, relations, transformations, solving, calculus, and symbolic UI inspection remain experimental. They are excluded from 0.1.4 and must not be presented as native core features.

The same rule applies to every future feature: it enters the numbered native guide only after parsing, lowering, executable generation, runtime behavior, and native `vkf -t` verification pass on the release targets.

## Development

The native compiler is under `compiler/native`. The self-hosted standard-library sources are under `compiler/self_hosted/stdlib`.

Compiler, runtime, standard-library, packaging, and test paths contain and
invoke no Python. Cross-language benchmark fixtures are isolated under
`benchmarks/core-comparison` and never participate in those paths.

The runnable guide examples are committed under `examples/generated/readme` and
verified by the native release workflow.

The 0.1.4 acceptance suite is run by VKF itself:

```bash
vkf -t tests/vkf
```

The expected result is `301 passed, 0 failed`. Physics, UI, and symbolic fixtures live outside this release directory. Run the additional native build and standard-library proofs in the [testing guide](/testing). Build and packaging details are in the [installation guide](/install), and release procedures are in [RELEASES.md](https://github.com/svenviktorjonsson/vektor-flow/blob/main/RELEASES.md).

VS Code syntax support is under [`vscode/`](../vscode/README.md).

## Status

VKF 0.1.4 is a deliberately incomplete native preview. Use GitHub Issues for reproducible compiler, installer, documentation, and safety problems.
