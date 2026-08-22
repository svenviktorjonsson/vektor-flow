# Vektor Flow Language Guide

**Designed by Viktor Jonsson.**

Vektor Flow (VKF) is an experimental, scope-based language for compact native programs, structured data, mathematics, and eventually visual applications.

Its central ideas are bindings that build scope, blocks that return values, callable types, structural operations, and functions that automatically apply across compatible elements.

> [!WARNING]
> VKF 0.1.2 is an experimental preview, not a supported production language. It has bugs, incomplete diagnostics, and unstable APIs and syntax.
>
> The visual system is intended to become VKF's strongest feature, but `ui`, `physics`, and `symbolic` are not included in the native 0.1.2 release.

## Release History

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

## Download And Run VKF 0.1.2

Download VKF from the [0.1.2 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.2).

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
| Measured UTC | `2026-08-22T09:51:01.458Z` | `2026-08-22T09:48:21.376Z` | `2026-08-22T09:47:19.920Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | AMD EPYC 7763 64-Core Processor | AMD EPYC 7763 64-Core Processor | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 3,677,184 bytes | 4,754,240 bytes | 2,169,272 bytes |
| Compiler SHA-256 | `be8620b66c2581b888b35f602d1b140e24b0e5c9e3e6fb09551631746d81660f` | `81cbcb6a2f27c4382c259d19af424bbd4657c209b42f4d4fa31e841ae0a5b44f` | `96d74dba30aee633828b49ea8607da9a15bc90f8039bca8d448a0760ed489f6e` |
| Timing host | v22.23.2 `Node performance.now()` | v22.23.2 `Node performance.now()` | v22.23.1 `Node performance.now()` |
<!-- readme-platform-evidence:end -->

The dedicated `core/12b-container-stress.vkf` example always performs 10
million fixed-container element updates and reads, then prints only the
checksum. Its work count is never adjusted to target a preferred duration.

### Native 0.1.2 Scope

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
| Compile | 2.139 ± 0.300 ms | 0.431 ± 0.014 ms | 0.757 ± 0.209 ms |
| Runtime | 17.316 ± 1.006 ms | 1.838 ± 0.083 ms | 1.580 ± 0.118 ms |

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
| Compile | 1.839 ± 0.305 ms | 0.315 ± 0.020 ms | 0.681 ± 0.144 ms |
| Runtime | 17.323 ± 0.774 ms | 1.828 ± 0.070 ms | 1.559 ± 0.126 ms |

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
| Compile | 12.193 ± 30.833 ms | 1.013 ± 0.031 ms | 1.075 ± 0.123 ms |
| Runtime | 17.269 ± 0.998 ms | 1.869 ± 0.082 ms | 1.563 ± 0.134 ms |

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
| Compile | 1.875 ± 0.321 ms | 0.340 ± 0.020 ms | 0.729 ± 0.119 ms |
| Runtime | 17.307 ± 1.023 ms | 1.821 ± 0.062 ms | 1.553 ± 0.119 ms |

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
| Compile | 1.912 ± 0.562 ms | 0.366 ± 0.014 ms | 0.702 ± 0.086 ms |
| Runtime | 17.178 ± 0.955 ms | 1.820 ± 0.092 ms | 1.536 ± 0.125 ms |

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
| Compile | 2.738 ± 0.372 ms | 0.735 ± 0.014 ms | 0.941 ± 0.158 ms |
| Runtime | 17.199 ± 0.952 ms | 1.876 ± 0.097 ms | 1.533 ± 0.120 ms |

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
| Compile | 2.281 ± 0.460 ms | 0.524 ± 0.016 ms | 0.808 ± 0.076 ms |
| Runtime | 17.235 ± 1.047 ms | 1.848 ± 0.049 ms | 1.531 ± 0.106 ms |

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
| Compile | 2.588 ± 0.427 ms | 0.653 ± 0.019 ms | 0.885 ± 0.181 ms |
| Runtime | 17.154 ± 0.950 ms | 1.855 ± 0.061 ms | 1.540 ± 0.118 ms |

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
| Compile | 2.568 ± 0.643 ms | 0.656 ± 0.037 ms | 0.876 ± 0.130 ms |
| Runtime | 17.225 ± 0.887 ms | 1.855 ± 0.082 ms | 1.538 ± 0.115 ms |

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
| Compile | 2.443 ± 0.392 ms | 0.575 ± 0.038 ms | 0.833 ± 0.140 ms |
| Runtime | 17.152 ± 0.815 ms | 1.893 ± 0.076 ms | 1.548 ± 0.130 ms |

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
| Compile | 2.256 ± 0.192 ms | 0.551 ± 0.038 ms | 0.828 ± 0.256 ms |
| Runtime | 17.234 ± 0.980 ms | 1.863 ± 0.060 ms | 1.541 ± 0.129 ms |

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
| Compile | 3.289 ± 0.412 ms | 0.996 ± 0.065 ms | 1.027 ± 0.082 ms |
| Runtime | 59.724 ± 2.049 ms | 43.582 ± 0.650 ms | 38.832 ± 1.004 ms |

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
| Compile | 3.121 ± 0.519 ms | 0.980 ± 0.062 ms | 1.030 ± 0.117 ms |
| Runtime | 22.350 ± 43.246 ms | 1.989 ± 0.098 ms | 1.632 ± 0.190 ms |

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
| Compile | 3.509 ± 1.468 ms | 1.234 ± 0.065 ms | 1.657 ± 0.206 ms |
| Runtime | 24.572 ± 71.039 ms | 1.863 ± 0.055 ms | 1.559 ± 0.141 ms |

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
| Compile | 1.971 ± 0.321 ms | 0.370 ± 0.026 ms | 0.700 ± 0.146 ms |
| Runtime | 18.386 ± 12.558 ms | 1.861 ± 0.052 ms | 1.528 ± 0.112 ms |

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
| Compile | 2.127 ± 0.638 ms | 0.451 ± 0.027 ms | 0.798 ± 0.144 ms |
| Runtime | 19.294 ± 20.459 ms | 1.837 ± 0.067 ms | 1.544 ± 0.140 ms |

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
| Compile | 2.224 ± 0.510 ms | 0.481 ± 0.042 ms | 0.748 ± 0.093 ms |
| Runtime | 17.494 ± 3.188 ms | 1.837 ± 0.082 ms | 1.553 ± 0.162 ms |

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
| Compile | 2.862 ± 2.698 ms | 0.634 ± 0.014 ms | 0.984 ± 0.610 ms |
| Runtime | 17.250 ± 0.826 ms | 1.877 ± 0.096 ms | 1.511 ± 0.072 ms |

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
| Compile | 1.692 ± 0.764 ms | 0.225 ± 0.014 ms | 0.610 ± 0.084 ms |
| Runtime | 17.255 ± 0.940 ms | 1.833 ± 0.078 ms | 1.512 ± 0.081 ms |

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
| Compile | 6.655 ± 15.737 ms | 0.585 ± 0.045 ms | 0.798 ± 0.090 ms |
| Runtime | 18.578 ± 14.099 ms | 1.826 ± 0.073 ms | 1.538 ± 0.128 ms |

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
| Compile | 2.799 ± 0.884 ms | 0.737 ± 0.059 ms | 0.901 ± 0.127 ms |
| Runtime | 20.386 ± 31.236 ms | 1.839 ± 0.095 ms | 1.532 ± 0.122 ms |

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
| Compile | 3.038 ± 0.326 ms | 0.897 ± 0.075 ms | 0.966 ± 0.086 ms |
| Runtime | 18.919 ± 14.322 ms | 1.827 ± 0.070 ms | 1.524 ± 0.127 ms |

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
| Compile | 2.753 ± 0.295 ms | 0.811 ± 0.055 ms | 0.919 ± 0.111 ms |
| Runtime | 18.795 ± 14.313 ms | 1.852 ± 0.081 ms | 1.525 ± 0.127 ms |

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
| Compile | 3.322 ± 0.381 ms | 1.028 ± 0.073 ms | 1.059 ± 0.110 ms |
| Runtime | 17.574 ± 1.221 ms | 1.865 ± 0.059 ms | 1.525 ± 0.131 ms |

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
| Compile | 1.996 ± 0.236 ms | 0.405 ± 0.029 ms | 0.698 ± 0.082 ms |
| Runtime | 17.471 ± 1.207 ms | 1.851 ± 0.095 ms | 1.529 ± 0.121 ms |

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
| Compile | 2.511 ± 0.492 ms | 0.682 ± 0.042 ms | 1.185 ± 2.912 ms |
| Runtime | 17.695 ± 1.490 ms | 1.842 ± 0.067 ms | 1.528 ± 0.131 ms |

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
| Compile | 2.408 ± 0.278 ms | 0.654 ± 0.039 ms | 0.860 ± 0.163 ms |
| Runtime | 17.475 ± 1.248 ms | 1.821 ± 0.061 ms | 1.517 ± 0.110 ms |

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
| Compile | 2.477 ± 1.238 ms | 0.580 ± 0.040 ms | 0.829 ± 0.104 ms |
| Runtime | 17.724 ± 1.403 ms | 1.865 ± 0.051 ms | 1.521 ± 0.115 ms |

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
| Compile | 7.928 ± 25.374 ms | 0.671 ± 0.043 ms | 0.884 ± 0.131 ms |
| Runtime | 17.658 ± 1.264 ms | 1.887 ± 0.082 ms | 1.520 ± 0.118 ms |

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
| Compile | 2.522 ± 0.336 ms | 0.687 ± 0.045 ms | 0.876 ± 0.091 ms |
| Runtime | 17.546 ± 1.174 ms | 1.893 ± 0.082 ms | 1.519 ± 0.124 ms |

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
| Compile | 3.349 ± 0.506 ms | 1.091 ± 0.073 ms | 1.105 ± 0.139 ms |
| Runtime | 17.493 ± 1.095 ms | 1.884 ± 0.084 ms | 1.529 ± 0.130 ms |

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
| Compile | 2.093 ± 0.265 ms | 0.503 ± 0.033 ms | 0.754 ± 0.085 ms |
| Runtime | 17.529 ± 1.214 ms | 1.843 ± 0.078 ms | 1.537 ± 0.142 ms |

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
| Compile | 17.120 ± 1.640 ms | 5.393 ± 0.366 ms | 3.958 ± 0.256 ms |
| Runtime | 17.367 ± 1.148 ms | 1.946 ± 0.097 ms | 1.529 ± 0.130 ms |

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
| Compile | 2.040 ± 0.148 ms | 0.423 ± 0.018 ms | 0.728 ± 0.131 ms |
| Runtime | 17.222 ± 1.059 ms | 1.824 ± 0.085 ms | 1.526 ± 0.125 ms |

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
| Compile | 3.269 ± 11.557 ms | 0.494 ± 0.026 ms | 0.801 ± 0.161 ms |
| Runtime | 17.272 ± 0.969 ms | 1.811 ± 0.072 ms | 1.519 ± 0.105 ms |

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
| Compile | 3.503 ± 4.099 ms | 0.838 ± 0.047 ms | 0.941 ± 0.090 ms |
| Runtime | 17.350 ± 1.238 ms | 1.829 ± 0.070 ms | 1.520 ± 0.113 ms |

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
| Compile | 3.397 ± 0.471 ms | 0.965 ± 0.044 ms | 1.239 ± 0.126 ms |
| Runtime | 17.153 ± 0.945 ms | 1.823 ± 0.081 ms | 1.536 ± 0.110 ms |

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
| Compile | 2.309 ± 0.303 ms | 0.562 ± 0.031 ms | 0.829 ± 0.073 ms |
| Runtime | 17.372 ± 1.038 ms | 1.899 ± 0.098 ms | 1.531 ± 0.106 ms |

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
| Compile | 7.571 ± 33.420 ms | 0.465 ± 0.030 ms | 0.768 ± 0.089 ms |
| Runtime | 17.409 ± 1.205 ms | 1.862 ± 0.087 ms | 1.530 ± 0.114 ms |

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
| Compile | 2.390 ± 0.325 ms | 0.566 ± 0.034 ms | 0.802 ± 0.119 ms |
| Runtime | 17.350 ± 1.175 ms | 1.863 ± 0.077 ms | 1.520 ± 0.095 ms |

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
| Compile | 1.688 ± 0.325 ms | 0.275 ± 0.221 ms | 0.621 ± 0.064 ms |
| Runtime | 17.309 ± 1.187 ms | 1.819 ± 0.064 ms | 1.519 ± 0.102 ms |

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
| Compile | 2.960 ± 0.491 ms | 0.863 ± 0.040 ms | 0.972 ± 0.106 ms |
| Runtime | 17.260 ± 1.006 ms | 1.847 ± 0.109 ms | 1.516 ± 0.087 ms |

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
| Compile | 2.867 ± 1.975 ms | 0.681 ± 0.014 ms | 1.338 ± 4.311 ms |
| Runtime | 17.182 ± 1.031 ms | 1.817 ± 0.079 ms | 1.527 ± 0.085 ms |

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
| Compile | 2.252 ± 0.849 ms | 0.557 ± 0.032 ms | 0.780 ± 0.078 ms |
| Runtime | 17.330 ± 1.127 ms | 1.818 ± 0.077 ms | 1.508 ± 0.076 ms |

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
| Compile | 2.229 ± 0.329 ms | 0.499 ± 0.021 ms | 0.799 ± 0.134 ms |
| Runtime | 17.321 ± 1.011 ms | 1.874 ± 0.067 ms | 1.511 ± 0.069 ms |

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
| Compile | 3.025 ± 0.333 ms | 0.934 ± 0.014 ms | 1.000 ± 0.167 ms |
| Runtime | 17.326 ± 0.996 ms | 1.948 ± 0.066 ms | 1.521 ± 0.099 ms |

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
| Compile | 31.893 ± 3.491 ms | 9.766 ± 0.141 ms | 6.764 ± 0.448 ms |
| Runtime | 17.232 ± 0.906 ms | 1.843 ± 0.069 ms | 1.513 ± 0.074 ms |

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
| Compile | 16.087 ± 1.839 ms | 5.317 ± 0.098 ms | 3.980 ± 1.360 ms |
| Runtime | 17.194 ± 0.976 ms | 1.843 ± 0.075 ms | 1.516 ± 0.090 ms |

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
| Compile | 10.747 ± 32.740 ms | 0.486 ± 0.013 ms | 0.805 ± 0.161 ms |
| Runtime | 17.365 ± 0.954 ms | 1.803 ± 0.090 ms | 1.513 ± 0.084 ms |

<!-- readme-evidence:end -->

## 10. Native Standard Library

These modules are part of the native 0.1.2 release on Windows x64, Linux x64, and macOS ARM64.

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
| Compile | 17.092 ± 2.902 ms | 5.230 ± 0.052 ms | 3.809 ± 0.313 ms |
| Runtime | 17.300 ± 1.107 ms | 1.853 ± 0.077 ms | 1.529 ± 0.098 ms |

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
| Compile | 2.514 ± 0.492 ms | 0.582 ± 0.017 ms | 0.893 ± 0.736 ms |
| Runtime | 17.292 ± 1.136 ms | 1.834 ± 0.093 ms | 1.521 ± 0.098 ms |

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
| Compile | 6.170 ± 4.008 ms | 2.039 ± 0.032 ms | 2.203 ± 4.388 ms |
| Runtime | 17.225 ± 0.987 ms | 1.847 ± 0.088 ms | 1.530 ± 0.112 ms |

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
| Compile | 23.777 ± 4.445 ms | 8.431 ± 0.074 ms | 5.982 ± 0.596 ms |
| Runtime | 17.990 ± 1.223 ms | 1.945 ± 0.113 ms | 1.926 ± 0.122 ms |

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
| Compile | 10.929 ± 33.986 ms | 1.071 ± 0.016 ms | 1.335 ± 0.149 ms |
| Runtime | 22.644 ± 46.123 ms | 1.956 ± 0.087 ms | 1.884 ± 0.111 ms |

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
| Compile | 4.293 ± 0.898 ms | 1.324 ± 0.021 ms | 1.610 ± 2.820 ms |
| Runtime | 17.472 ± 1.019 ms | 1.873 ± 0.081 ms | 1.560 ± 0.102 ms |

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
| Compile | 3.232 ± 0.311 ms | 0.920 ± 0.017 ms | 1.221 ± 0.152 ms |
| Runtime | 17.292 ± 0.929 ms | 1.839 ± 0.092 ms | 1.545 ± 0.093 ms |

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
C:\Users\RUNNER~1\AppData\Local\Temp\vkf-readme-proof-X0WOzS\runtime\stdlib\08-system
true
```

**Linux x64:**

```text
linux
x86_64
4
/tmp/vkf-readme-proof-6h8Ofb/runtime/stdlib/08-system
true
```

**macOS ARM64:**

```text
macos
arm64
3
/private/var/folders/_5/zjnzxgh147qcg3bb5cg2wvqw0000gn/T/vkf-readme-proof-uXNPIn/runtime/stdlib/08-system
true
```

| 100 measured runs | Windows x64 | Linux x64 | macOS ARM64 |
| --- | ---: | ---: | ---: |
| Compile | 3.539 ± 1.242 ms | 0.992 ± 0.016 ms | 1.127 ± 0.120 ms |
| Runtime | 17.341 ± 1.163 ms | 1.889 ± 0.083 ms | 1.546 ± 0.093 ms |

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
| Compile | 3.349 ± 1.708 ms | 0.813 ± 0.013 ms | 1.027 ± 0.109 ms |
| Runtime | 46.131 ± 2.494 ms | 3.404 ± 0.104 ms | 6.076 ± 0.310 ms |

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
| Compile | 3.276 ± 1.458 ms | 0.855 ± 0.016 ms | 1.065 ± 0.153 ms |
| Runtime | 17.740 ± 1.017 ms | 1.857 ± 0.085 ms | 1.707 ± 0.145 ms |

<!-- readme-evidence:end -->

## 11. Coming Soon

The following areas are planned, but unavailable in the native 0.1.2 release. Their repository prototypes and legacy examples are not part of the supported compiler surface.

### 11.1 Native `ui`

The visual and scene system is not in the native 0.1.2 compiler. Older repository examples may run through legacy tooling, but they are not evidence of the released native language.

### 11.2 Native `physics`

Rigid-body work belongs under `physics`, but the module is partial and excluded from 0.1.2. No `rigid_body` compatibility module ships in the release.

### 11.3 Native `symbolic`

Symbolic domains, relations, transformations, solving, calculus, and symbolic UI inspection remain experimental. They are excluded from 0.1.2 and must not be presented as native core features.

The same rule applies to every future feature: it enters the numbered native guide only after parsing, lowering, executable generation, runtime behavior, and native `vkf -t` verification pass on the release targets.

## Development

The native compiler is under `compiler/native`. The self-hosted standard-library sources are under `compiler/self_hosted/stdlib`.

Compiler, runtime, standard-library, packaging, and test paths contain and
invoke no Python. Cross-language benchmark fixtures are isolated under
`benchmarks/core-comparison` and never participate in those paths.

The runnable guide examples are committed under `examples/generated/readme` and
verified by the native release workflow.

The 0.1.2 acceptance suite is run by VKF itself:

```bash
vkf -t tests/vkf
```

The expected result is `296 passed, 0 failed`. Physics, UI, and symbolic fixtures live outside this release directory. Run the additional native build and standard-library proofs described in [TESTING.md](../TESTING.md). Build and packaging details are in [INSTALL.md](../INSTALL.md), and release procedures are in [RELEASES.md](../RELEASES.md).

VS Code syntax support is under `editors/vscode-vektor-flow`.

## Status

VKF 0.1.2 is a deliberately incomplete native preview. Use GitHub Issues for reproducible compiler, installer, documentation, and safety problems.
