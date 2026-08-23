# Vektor Flow Language Guide

**Designed by Viktor Jonsson.**

Vektor Flow (VKF) is an experimental, scope-based language for compact native programs, structured data, mathematics, and eventually visual applications.

Its central ideas are bindings that build scope, blocks that return values,
callable types, explicit structured values, named tensor axes, and functions
that automatically lift through vectors with exact element types.

> [!WARNING]
> VKF 0.1.7 is an experimental preview, not a supported production language. It has bugs, incomplete diagnostics, and unstable APIs and syntax.
>
> The visual system is intended to become VKF's strongest feature, but `ui`, `physics`, and `symbolic` are not included in the native 0.1.7 release.

## Release History

### 0.1.7 — Wider SysV Numeric Register Cache

0.1.7 expands the call-free SysV x64 numeric cache from XMM6/XMM7 to XMM6
through XMM15. More hot loop locals can remain in registers instead of being
reloaded from stack slots. Windows keeps the smaller ABI-safe allocation. The
landing page uses one controlled 1,000-run comparison table and retains the
raw samples, source hashes, compiler hash, output parity, and environment in
the linked report.

### 0.1.6 — Strict Vector Lifting And Axis Reductions

0.1.6 restricts automatic function lifting to vector layers with exact element
types. Tuples and records are atomic and use explicit whole-value functions or
operator overloads. `stat.sum` recursively reduces all vector dimensions by
default and accepts constant integer, negative, or tuple axes for fixed
rectangular numeric vectors. Alias-aware overload resolution now finishes in
typed IR instead of guessing from aggregate layout during machine lowering.
The current native suite contains 320 VKF tests.

### 0.1.5 — Adaptive Native Optimization

0.1.5 represents eight legal x64 lowering choices as policy data. The compiler
can verify and time program-specific variants within a compilation budget,
deduplicate identical machine code, and retain the selected policy for the exact
program and host. Safe packed matrix and dual-dot reductions join aggregate
forwarding, native integer/index lowering, parity specialization, and FMA as
independent decisions. The current native suite contains 320 VKF tests plus
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
- compound aggregate updates were introduced here; current vector-only arithmetic and explicit tuple/record overload rules are documented in section 2.5;
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

## Download And Run VKF 0.1.7

Download VKF from the [0.1.7 GitHub release](https://github.com/svenviktorjonsson/vektor-flow/releases/tag/v0.1.7).

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
| Measured UTC | `2026-08-23T11:01:50.273Z` | `2026-08-23T10:57:47.151Z` | `2026-08-23T10:56:27.799Z` |
| OS | `win32 10.0.26100` | `linux 6.8.0-1064-azure` | `darwin 24.6.0` |
| Architecture | `x64` | `x64` | `arm64` |
| CPU | AMD EPYC 7763 64-Core Processor | AMD EPYC 7763 64-Core Processor | Apple M1 (Virtual) |
| Logical CPUs | 4 | 4 | 3 |
| Compiler size | 4,003,328 bytes | 5,205,520 bytes | 2,261,160 bytes |
| Compiler SHA-256 | `87c3baf994b7890033471e318333260d88ca5805142ca0576fa55d2291ce02cb` | `d4d59ba1ba248648071a182c403918991e9226a83edc5f1ed6ece218da273e03` | `f743c47711e02d4047a6b29613a4e71c3b580a8d1b138a86572b80a3c64f336d` |
| Timing host | v22.23.2 `Node performance.now()` | v22.23.2 `Node performance.now()` | v22.23.1 `Node performance.now()` |
<!-- readme-platform-evidence:end -->

The dedicated `core/12b-container-stress.vkf` example always performs 10
million fixed-container element updates and reads, then prints only the
checksum. Its work count is never adjusted to target a preferred duration.

### Native 0.1.7 Scope

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

<!-- readme-evidence:end -->

### 2.5 Aggregate Updates And Aliases

Compound updates also require the explicit leading dot: `.name +:`, `.name -:`,
`.name *:`, `.name /:`, `.name //:`, `.name %:`, and `.name /\:`. The native
implementation preserves aggregate alias identity across these updates. Built-in
vector arithmetic distributes over vector elements. Tuple and record arithmetic
is never inferred field-by-field; define an operator overload for the complete
type instead.

<!-- readme-example: core/13-updates-aliases.vkf -->
```vkf
values: [1, 2]
alias: values
.values +: [3, 4]
.values *: 2
.values -: [2, 4]
.values /: 2
:: alias

Point: (x:int, y:int, name:str)

+(point:Point, delta:int) -> Point:
    (x: point.x + delta, y: point.y + delta, name: point.name)

p: (x:3, y:4, name:"my point")
.p +: 2
:: p
```

<!-- readme-evidence:start core/13-updates-aliases.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[3, 4]
(x:5, y:6, name:my point)
```

<!-- readme-evidence:end -->

The exact output is `[3, 4]` followed by `(x:5, y:6, name:my point)`. The vector
updates are built in; the record update resolves the declared `+` overload.
Both updates remain visible through older aliases of the same aggregate.

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

<!-- readme-evidence:end -->

## 4. Automatic Vector Function Application

Vector lifting is a core language rule, not a special feature of `math`. If a
whole argument does not match a one-parameter function, VKF may descend through
vector layers and call the function on exact matching elements. It never searches
inside tuples or records for fields to transform.

### 4.1 Exact Vector Elements Are Selected

The element type must match the parameter type exactly. Nested vectors are
traversed recursively and retain their shape.

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

The first call lifts over one vector layer. The second reaches the same `int`
leaf type through two vector layers.

### 4.2 Lifting Does Not Use Conversions

Ordinary direct calls may still convert `int` to `num`, but conversion does not
select elements for implicit lifting. A function accepting `num` lifts over a
`[num]`; passing `[int]` is a compile error rather than a partial or converted
map.

<!-- readme-example: core/26-structural-conversions.vkf -->
```vkf
halve(value:num) -> num:
    value / 2

values: [8.0, 3.0, -4.0]
:: halve(values)
```

<!-- readme-evidence:start core/26-structural-conversions.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[4, 1.5, -2]
```

<!-- readme-evidence:end -->

### 4.3 Tuples And Records Are Atomic

VKF does not inspect tuple or record fields looking for compatible scalars. A
tuple or record may still be the exact element type of a vector, so a function
accepting that complete type can lift over a vector of those values.

<!-- readme-example: core/27-structural-recursion.vkf -->
```vkf
translate(point:(x:int,y:int)) -> (x:int,y:int):
    (x:point.x + 10, y:point.y - 10)

points: [(x:1, y:2), (x:3, y:4)]
:: translate(points)
```

<!-- readme-evidence:start core/27-structural-recursion.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[(x:11, y:-8), (x:13, y:-6)]
```

<!-- readme-evidence:end -->

Calling `translate((x:1, y:2))` is one direct record call. Calling
`translate(points)` lifts through the outer vector, then calls `translate` once
per complete record. Calling `translate((name:"sample", x:1, y:2))` does not
search for the `x` and `y` subset.

### 4.4 Container Functions Can Lift Over Outer Vectors

A function accepting a complete vector row can lift over a matrix when each row
has that exact vector type.

<!-- readme-example: core/28-structural-records.vkf -->
```vkf
row_sum(row:[int]) -> num:
    stat.sum(row)

matrix: [[1, 2], [3, 4], [5, 6]]

:: row_sum(matrix)
```

<!-- readme-evidence:start core/28-structural-records.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[3, 7, 11]
```

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

<!-- readme-evidence:end -->

### 4.6 Math Uses The Same Vector Rule

Math functions lift recursively through numeric vectors. They do not transform
numeric fields hidden inside tuples or records. This includes `abs`, roots,
trigonometry, logs, exponentials, hyperbolic functions, `gamma`, and `erf`.

<!-- readme-example: core/30-math-structural.vkf -->
```vkf
math: .math

signed: [[-1.0, 4.0], [-9.0, 16.0]]
positive: [[1.0, 4.0], [9.0, 16.0]]

:: math.abs(signed)
:: math.sqrt(positive)
```

<!-- readme-evidence:start core/30-math-structural.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
[[1, 4], [9, 16]]
[[1, 2], [3, 4]]
```

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

<!-- readme-evidence:end -->

## 10. Native Standard Library

These modules are part of the native 0.1.7 release on Windows x64, Linux x64, and macOS ARM64.

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

<!-- readme-evidence:end -->

Unary math functions use the exact vector-lifting rule in section 4.

### 10.2 `stat`

Functions include `sum`, `mean`, `count`, `min`, `max`, `range`, `variance`, `std`, `percentile`, `median`, `iqr`, `mode`, `zscore`, `normalize`, `covariance`, `correlation`, `clamp`, and `sign`. `sum` reduces every nested vector dimension by default. Its named `axis` argument accepts one constant integer or a nonempty tuple of constant integers; negative values count from the last dimension.

<!-- readme-example: stdlib/02-stat.vkf -->
```vkf
values: [2, 4, 4, 4, 5, 5, 7, 9]
matrix: [[1, 2, 3], [4, 5, 6]]
:: stat.mean(values)
:: stat.variance(values)
:: stat.std(values)
:: stat.range(values)
:: stat.sum(matrix)
:: stat.sum(matrix, axis: 0)
:: stat.sum(matrix, axis: 1)
```

<!-- readme-evidence:start stdlib/02-stat.vkf -->

**Recorded stdout (exit code `0`; stderr empty), all platforms:**

```text
5
4
2
7
21
[5, 7, 9]
[6, 15]
```

<!-- readme-evidence:end -->

For a matrix, `axis:0` reduces rows and returns column sums; `axis:1` reduces
columns and returns row sums. A tuple such as `axis:(0, 2)` reduces both named
dimensions. Axis reduction currently requires a fixed rectangular numeric
vector. Duplicate and out-of-range axes are compile errors. `variance` and
`std` accept `ddof`; zero is the population form and one is the sample form.

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
C:\Users\RUNNER~1\AppData\Local\Temp\vkf-readme-proof-6DaUbC\runtime\stdlib\08-system
true
```

**Linux x64:**

```text
linux
x86_64
4
/tmp/vkf-readme-proof-94Pbry/runtime/stdlib/08-system
true
```

**macOS ARM64:**

```text
macos
arm64
3
/private/var/folders/_5/zjnzxgh147qcg3bb5cg2wvqw0000gn/T/vkf-readme-proof-DVCni6/runtime/stdlib/08-system
true
```

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

<!-- readme-evidence:end -->

## 11. Coming Soon

The following areas are planned, but unavailable in the native 0.1.7 release. Their repository prototypes and legacy examples are not part of the supported compiler surface.

### 11.1 Native `ui`

The visual and scene system is not in the native 0.1.7 compiler. Older repository examples may run through legacy tooling, but they are not evidence of the released native language.

### 11.2 Native `physics`

Rigid-body work belongs under `physics`, but the module is partial and excluded from 0.1.7. No `rigid_body` compatibility module ships in the release.

### 11.3 Native `symbolic`

Symbolic domains, relations, transformations, solving, calculus, and symbolic UI inspection remain experimental. They are excluded from 0.1.7 and must not be presented as native core features.

The same rule applies to every future feature: it enters the numbered native guide only after parsing, lowering, executable generation, runtime behavior, and native `vkf -t` verification pass on the release targets.

## Development

The native compiler is under `compiler/native`. The self-hosted standard-library sources are under `compiler/self_hosted/stdlib`.

Compiler, runtime, standard-library, packaging, and test paths contain and
invoke no Python. Cross-language benchmark fixtures are isolated under
`benchmarks/core-comparison` and never participate in those paths.

The runnable guide examples are committed under `examples/generated/readme` and
verified by the native release workflow.

The 0.1.7 acceptance suite is run by VKF itself:

```bash
vkf -t tests/vkf
```

The expected result on current main is `320 passed, 0 failed`. Physics, UI, and symbolic fixtures live outside this release directory. Run the additional native build and standard-library proofs in the [testing guide](/testing). Build and packaging details are in the [installation guide](/install), and release procedures are in [RELEASES.md](https://github.com/svenviktorjonsson/vektor-flow/blob/main/RELEASES.md).

VS Code syntax support is under [`vscode/`](https://github.com/svenviktorjonsson/vektor-flow/blob/main/vscode/README.md).

## Status

VKF 0.1.7 is a deliberately incomplete native preview. Use GitHub Issues for reproducible compiler, installer, documentation, and safety problems.
