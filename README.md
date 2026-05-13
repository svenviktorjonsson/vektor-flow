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

message ::
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
- `message ::` prints the value.

## Install And Run

Install from this repository:

```bash
pip install -e .[dev]
```

Run a file:

```bash
vkf examples/hello.vkf
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
x + y ::
```

`=` is equality, not assignment:

```vkf
(x = 3) ::     # true
(x = y) ::     # false
```

### Blocks Return Their Last Row

Any indented block evaluates to its last row.

```vkf
total:
    a: 10
    b: 20
    a + b

total ::       # 30
```

Use `@:` for an early return.

```vkf
classify(n):
    n < 0? @: "negative"
    n = 0? @: "zero"
    @: "positive"

classify(-2) ::
```

If you want a block to act as a namespace/struct, return the local scope with a
final `:`.

```vkf
geometry:
    points: [[0, 0], [1, 0], [1, 1]]
    color: [1, 0, 0, 1]
    :

geometry.points ::
```

### Print With `::`

```vkf
"hello" ::
(2 + 3) ::
```

`@::` returns and prints from inside a function.

```vkf
debug_square(x):
    @:: x * x

debug_square(5)
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
"x rounded is $x.2f" ::    # x rounded is 4.23
```

Use `$(...)` when the expression is more than a simple name or field access.

```vkf
a: 2
b: 3
"sum=$(a + b)" ::
```

### Tuples

Tuples are positional values.

```vkf
point: (3, 4)
point.(0) ::     # 3
point.(1) ::     # 4
```

Use tuples for fixed positional bundles.

### Structs

Structs are named records.

```vkf
point: (x: 3, y: 4)
point.x ::
point.y ::
```

Struct updates create a new value for that binding.

```vkf
point.z: 5
point ::
```

### Vectors

Vectors use square brackets.

```vkf
values: [1, 2, 3, 4]
values.(2) ::      # 3
```

Finite ranges can build vectors:

```vkf
numbers: [1..5]
numbers ::         # [1, 2, 3, 4, 5]
```

`..n` starts at zero:

```vkf
zero_to_three: [..3]
```

### Multisets

Multisets use `{value: count}` and store multiplicities.

```vkf
a: {1: 2, 2: 1}
b: {1: 1, 3: 1}

(a + b) ::         # union by counts
(a * b) ::         # intersection by min counts
```

Multiset keys are sorted by the language ordering for the key type.

## Functions

A function is a named block with parameters.

```vkf
square(x):
    @: x * x

square(7) ::
```

Because blocks return their last row, short functions can omit `@:`.

```vkf
distance2(x, y):
    x*x + y*y

distance2(3, 4) ::
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
    "large" ::
    "small" ::
```

### Switch With `??` And `=>`

Use switch form when dispatching on a value.

```vkf
kind: "edge"

kind??
    "face" => "red"
    "edge" => "green"
    "vertex" => "blue"
    _ => "gray"
::
```

UI event loops use the same idea:

```vkf
(e: events.get())??>
    null =>
        ui.sleep(0.005)
    ui.MouseMove =>
        handle_move(e)
    ui.MouseDown =>
        handle_down(e)
```

## Pipes And `$`

`>>` evaluates the right side once for each element on the left. `$` is the
current element.

```vkf
squares: [1..5] >> $ * $
squares ::
```

Pipes preserve the container kind where possible.

```vkf
tuple_squares: (1..5) >> $ * $
vector_squares: [1..5] >> $ * $
```

Use functions inside pipes:

```vkf
square(x): x*x

[1..5] >> square($) ::
```

`..3 >> expr` is a compact loop from `0` through `3`.

```vkf
..3 >> "index=$" ::
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
"hello " & "world" ::
[1, 2] & [3, 4] ::
(a: 1) & (b: 2) ::
```

Absolute value and vector norm use bars:

```vkf
|-3| ::
|[3, 4]| ::
```

### Operator Overloads

Operators can be defined for your own types.

```vkf
Point: (x:num, y:num)

+(a:Point, b:Point):
    (x: a.x + b.x, y: a.y + b.y)

p: (x: 1, y: 2)
q: (x: 3, y: 4)
(p + q) ::
```

Custom display works through `display`.

```vkf
display(value: Point):
    "Point($value.x, $value.y)"

p ::
```

## Modules And Scope

Import a module into a namespace:

```vkf
math: .math
math.sqrt(9) ::
```

Pour a module into the current scope with `:.module`.

```vkf
:.math
sqrt(9) ::
```

The same pour idea works for structs.

```vkf
point: (x: 3, y: 4)
:point
x + y ::
```

Files and folders are modules too. If `lib/helpers.vkf` exists:

```vkf
helpers: .lib.helpers
helpers.some_function() ::
```

Public names are exported. Names beginning with `_` are private by convention.

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
