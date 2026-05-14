# Vektor Flow

Vektor Flow is a small computational language for shaping data, defining
geometry, and driving interactive visual programs. It is built around a few
ideas that repeat everywhere:

- `:` binds names and builds scopes.
- Blocks return their last row.
- `[]` are vectors, `()` are tuples or structs, `{}` are multisets.
- `>>` pipes values through `$`.
- `::` prints.
- UI geometry is authored in `.vkf` and rendered by the native/WebGPU runtime.

File extension: `.vkf`.

## First Look

```vkf
name: "Ada"
score: 41

message:
    next: score + 1
    "Hello $name, next score is $next"

:: message
```

This prints:

```text
Hello Ada, next score is 42
```

Read this as:

- `name: "Ada"` binds a value.
- `message:` opens a scope.
- The scope returns its last row.
- `$name` and `$next` interpolate values into a string.
- `:: message` prints the value.

## Install And Run

Install from this repository:

```bash
pip install -e .[dev]
```

Run a file:

```bash
vkf examples/hello.vkf
```

Run a short snippet:

```powershell
vkf -e ':: "hello, world"'
vkf -e '..5 >> :: $^2'
```

Use single quotes around inline snippets in PowerShell when the snippet contains
`$`. Double quotes let PowerShell expand `$...` before `vkf` receives the code.

```powershell
vkf -e "..5 >> :: $^2"   # Wrong in PowerShell: `$^2` is expanded by the shell.
vkf -e '..5 >> :: $^2'   # Right: VKF receives `$^2`.
```

Useful commands:

```bash
vkf examples/language_features.vkf
vkf tokens examples/language_features.vkf --json
vkf package-runtime examples/ui_face_edge_vertex_drag.vkf --with-overlay
```

On Windows, interactive UI examples use the native overlay executable. Build it
when needed:

```powershell
.\scripts\build-vf-overlay.ps1
```

## The Core Mental Model

### Bind With `:`

`:` means "put the value on the right into the name on the left".

```vkf
x: 3
y: 4
:: x + y
```

`=` is equality, not assignment:

```vkf
:: (x = 3)     # true
:: (x = y)     # false
```

### Blocks Return Their Last Row

Any indented block evaluates to its last row.

```vkf
total:
    a: 10
    b: 20
    a + b

:: total       # 30
```

Use `@:` for an early return with a value.

```vkf
classify(n):
    n < 0? @: "negative"
    n = 0? @: "zero"
    @: "positive"

:: classify(-2)
```

Think of `@` as the return channel:

- `@` returns `null`.
- `@: value` returns `value`.
- `@:` with no value returns the current local scope.

That last form follows the same rule as a lone `:`: when the right side is
missing, `:` means "the current local scope as a value".

```vkf
make_point(x, y):
    x: x
    y: y
    @:
```

If you want a block to act as a namespace/struct without returning early, make
the final row a lone `:`.

```vkf
geometry:
    points: [[0, 0], [1, 0], [1, 1]]
    color: [1, 0, 0, 1]
    :

:: geometry.points
```

### Print With `::`

```vkf
:: "hello"
:: (2 + 3)
```

`::` is a print effect. It returns `null`, so a function whose last row is a
print also returns `null`.

```vkf
print_square(x):
    :: x * x

print_square(5)
```

Return a value with `@:` or by making the value the last row.

```vkf
square(x):
    @: x * x
```

### Comments Use `#`

```vkf
# This is a comment.
answer: 42
```

## Values

### Numbers, Strings, Booleans, Null

```vkf
n: 42
pi: 3.1415
name: "Ada"
ready: true
missing: null
```

Double-quoted strings support interpolation:

```vkf
x: 4.2345
:: "x rounded is $x.2f"    # x rounded is 4.23
```

Use `$(...)` when the expression is more than a simple name or field access.

```vkf
a: 2
b: 3
:: "sum=$(a + b)"
```

### Tuples

Tuples are positional values.

```vkf
point: (3, 4)
:: point.0       # 3
:: point.1       # 4
:: point.(0)     # 3, same as point.0
```

Use tuples for fixed positional bundles.

### Structs

Structs are named records.

```vkf
point: (x: 3, y: 4)
:: point.x
:: point.y
```

Struct updates create a new value for that binding.

```vkf
point.z: 5
:: point
```

### Vectors

Vectors use square brackets.

```vkf
values: [1, 2, 3, 4]
:: values.(2)      # 3
```

Finite ranges can build vectors:

```vkf
numbers: [1..5]
:: numbers         # [1, 2, 3, 4, 5]
```

`..n` starts at zero:

```vkf
zero_to_three: [..3]
```

### Axis Tags And Tensor-Style Operations

Attach named axes to vectors with `-> axis`. Matching axis names align; missing
axes broadcast. This makes elementwise math feel close to Einstein notation.

```vkf
a: [1, 2] -> i
b: [10, 20] -> j

outer: a * b
:: outer.idx      # ij
:: outer.(0).(1)  # 20
```

Shared axes multiply elementwise along that axis and broadcast across the rest.

```vkf
matrix: [[1, 2], [3, 4]] -> ij
scale: [10, 20] -> j

scaled: matrix * scale
:: scaled         # ((10, 40), (30, 80))
```

The older suffix form is still accepted for compact literals:

```vkf
v: [1, 2, 3]_i
```

### Multisets

Multisets use `{value: count}` and store multiplicities.

```vkf
a: {1: 2, 2: 1}
b: {1: 1, 3: 1}

:: (a + b)         # union by counts
:: (a - b)         # subtract counts, clamped at zero
:: (a // b)        # floor-divide counts for matching keys
:: (a % b)         # remainder of counts for matching keys
```

Multiset keys are sorted by the language ordering for the key type.

## Functions

A function is a named block with parameters.

```vkf
square(x):
    @: x * x

:: square(7)
```

Because blocks return their last row, short functions can omit `@:`.

```vkf
distance2(x, y):
    x*x + y*y

:: distance2(3, 4)
```

### Function Docstrings

A function can start with a string row. The VS Code extension uses that string
with the function signature for hover information.

```vkf
area(width:num, height:num):
    """Return rectangle area."""
    width * height
```

Multiline docstrings use the same style:

```vkf
normalize(v):
    """
    Return v scaled to unit length.
    Expects a non-zero vector.
    """
    v / |v|
```

### Type Annotations

Type annotations sit beside parameters.

```vkf
add(a:num, b:num):
    a + b
```

Type-shaped structs define reusable interfaces.

```vkf
Point: (x:num, y:num)

length2(p:Point):
    p.x*p.x + p.y*p.y
```

### Core Types And Type Reflection

Core scalar types are `num`, `int`, `str`, `bool`, and `null`. Containers add
shape:

```vkf
Point: (x:num, y:num)
Pair: (num, num)
Nums: [num:3]
Bag: {str}
```

A loose dot with no member asks for the type of a value.

```vkf
point: (x:3, y:4)

:: point.       # (x:num, y:num)
:: [1, 2, 3].   # [num:3]
```

You can spill a type's members into different containers.

```vkf
point: (x:3, y:4)

:: (:point.)    # (x:num, y:num)  key -> type struct
:: [:point.]    # [num, num]      member types
:: {:point.}    # {x:1, y:1}     member keys
```

## Control Flow

### If With `?`

```vkf
label(n):
    n < 0? @: "negative"
    n = 0? @: "zero"
    @: "positive"
```

Indented conditional bodies are allowed:

```vkf
x > 10?
    :: "large"
    :: "small"
```

### Switch With `??` And `=>`

Use switch form when dispatching on a value.

```vkf
kind: "edge"
color: "gray"

kind??
    "face" => color: "red"
    "edge" => color: "green"
    "vertex" => color: "blue"

:: color
```

UI event loops use the same idea:

```vkf
time: .time

(e: events.get())??>
    ui.MouseMove =>
        handle_move(e)
    ui.MouseDown =>
        handle_down(e)
    time.sleep(0.005)
```

## Pipes And `$`

`>>` evaluates the right side once for each element on the left. `$` is the
current element.

```vkf
squares: [1..5] >> $ * $
:: squares
```

Command-line demo:

```powershell
vkf -e '..5 >> :: $^2'
```

Output:

```text
0
1
4
9
16
25
```

Pipes preserve the container kind where possible.

```vkf
tuple_squares: (1..5) >> $ * $
vector_squares: [1..5] >> $ * $
```

Use functions inside pipes:

```vkf
square(x): x*x

:: [1..5] >> square($)
```

`..3 >> expr` is a compact loop from `0` through `3`.

```vkf
:: ..3 >> "index=$"
```

## Operators

Arithmetic:

```vkf
1 + 2
5 - 3
4 * 7
8 / 2
2 ^ 8
```

Logic:

```vkf
true /\ false     # and
true \/ false     # or
true >< false     # xor
~true             # not
```

Concatenation uses `&`.

```vkf
:: "hello " & "world"
:: [1, 2] & [3, 4]
:: (a: 1) & (b: 2)
```

Absolute value and vector norm use bars:

```vkf
:: |-3|
:: |[3, 4]|
```

### Operator Overloads

Operators can be defined for your own types.

```vkf
Point: (x:num, y:num)

+(a:Point, b:Point):
    (x: a.x + b.x, y: a.y + b.y)

p: (x: 1, y: 2)
q: (x: 3, y: 4)
:: (p + q)
```

Custom print display overloads the `::` operator.

```vkf
::(value: Point):
    :: "Point($value.x, $value.y)"

:: p
```

## Modules And Scope

Import a module into a namespace:

```vkf
math: .math
:: math.sqrt(9)
```

Pour a module into the current scope with `:.module`.

```vkf
:.math
:: sqrt(9)
```

The same pour idea works for structs.

```vkf
point: (x: 3, y: 4)
:point
:: x + y
```

Files and folders are modules too. If `lib/helpers.vkf` exists:

```vkf
helpers: .lib.helpers
:: helpers.some_function()
```

Public names are exported. Names beginning with `_` are private by convention.

## Standard Library

Stdlib modules are explicit. Bind them to a namespace with `name: .module`, or
pour them into scope with `:.module`.

```vkf
math: .math
time: .time
stat: .stat

:: math.sqrt(81)
time.sleep(0.01)
:: stat.mean([1, 2, 3])
```

Current public modules:

- `math`: constants and scalar math such as `pi`, `tau`, `sin`, `cos`, `sqrt`, `log`.
- `stat`: sequence statistics such as `mean`, `median`, `std`, `variance`, `percentile`, `normalize`, `zscore`.
- `time`: timing surface; use `time.sleep(seconds)`, `time.current_time()`, `time.time_stamp()`.
- `io`: file IO and compatibility sleeps: `read_text`, `write_text`, `read_bytes`, `write_bytes`, `read_numbers`, `sleep`, `sleep_ms`.
- `collections`: mutable runtime containers: `map`, `list`, `queue`.
- `capture`: regex helpers: `regex`, `groups`.
- `errors`: catchable error type values such as `PARSE_ERROR`, `EVAL_ERROR`, `TYPE_ERROR`.
- `ui`: interactive display namespace. `sleep` is not in `ui`; import `time` for delays.

## UI Overview

UI programs use the `ui` stdlib module and native overlay mode.

```vkf
ui:.ui
ui.set_mode("overlay")

frame: ui.Frame()
screen: ui.display

screen.add_frame(frame, (0.1, 0.1, 0.6, 0.6))
screen.render()
```

Geometry is described with representations and views. The runtime owns drawing
and picking through WebGPU.

```vkf
reps:
    vertex_rep(v, view):
        vertices: [view.point]
        vertex_color: view.color
        vertex_scale: 0.02
        :
    :

frame.add((i: 0,), reps.vertex_rep, (point: [0.5, 0.5], color: [0, 0.4, 1, 1]))
```

For a full working example, read:

```text
examples/ui_face_edge_vertex_drag.vkf
```

That example shows the recommended structure:

- `styles:` for colors and sizes.
- `reps:` for geometry representation functions.
- `geometry:` for points and topology.
- `selection:` for interaction state.
- `views:` for derived render state.
- `targets:` for hit-testing.
- `motion:` for state updates.

## Native Runtime Direction

The current project has two execution tracks:

- The Python interpreter remains the broad language reference.
- The native pipeline is growing toward Python-free runtime execution.

Native UI bundles package the overlay runtime, scene program, runtime packets,
and shared geometry ledger data.

```bash
vkf package-runtime examples/ui_face_edge_vertex_drag.vkf --with-overlay
```

The produced runtime should execute without Python after the `.vkf` program has
been parsed and packaged.

## VS Code

The `vscode/` folder contains the Vektor Flow extension.

Features:

- Syntax highlighting for `.vkf`.
- Run command for the current file.
- Function hover with signature and docstring.

Install it from VS Code with:

```text
Developer: Install Extension from Location...
```

Select the `vscode` folder in this repository.

## Useful Examples

```text
examples/hello.vkf
examples/language_features.vkf
examples/native_scene_probe.vkf
examples/ui_event_probe.vkf
examples/ui_face_edge_vertex_drag.vkf
```

Start with `examples/language_features.vkf` if you want a non-UI tour with lots
of printed output. Start with `examples/ui_face_edge_vertex_drag.vkf` if you
want the current interactive geometry model.

## Status

The language and runtime are still moving quickly. The most stable way to learn
the current surface is:

1. Read this README top to bottom.
2. Run `examples/language_features.vkf`.
3. Inspect `examples/ui_face_edge_vertex_drag.vkf`.
4. Use tests as executable documentation when behavior is unclear.
