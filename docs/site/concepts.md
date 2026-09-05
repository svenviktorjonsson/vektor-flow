# What VKF provides

[Guide](guide.md) / What

VKF combines a keyword-free, scope-based core with vector operations,
mathematical libraries and graphics. Start with the model below; follow a
link for exact rules, further examples or implementation details.

## Values, scopes and convenient syntax

Values are immutable; rebinding changes which value a name denotes. Operators,
types, functions and scopes form the core. Shorthand makes common operations
convenient without requiring a separate model.

[Bindings](../language-guide.md#1-programs-and-bindings) ·
[types and containers](../language-guide.md#2-values-types-and-containers) ·
[control flow and errors](../language-guide.md#5-control-flow-and-errors) ·
[pipes and ranges](../language-guide.md#6-pipes-ranges-and) ·
[scope and modules](../language-guide.md#9-modules-scope-and-dispatch).

## Functions, vectors and axes

Functions can apply through vector layers. Matching axes combine elementwise;
distinct axes form outer products. Change an axis tag below and inspect the
result. These are language operations, not a separate array library.

<!-- live-example: examples/introduction/named-axes.vkf -->

[Function matching and lifting](../language-guide.md#4-automatic-vector-function-application) ·
[shape and indexing rules](../language-guide.md#8-shapes-axes-and-indexing).

User-defined mathematical types can define operators as binary functions.
[Functions and generic types](../language-guide.md#3-functions-and-calls) ·
[operator overloads](../language-guide.md#73-operator-overloads).

## Mathematics

Numerical functions, symbolic expressions, linear algebra and dimensioned
quantities share the language's value model. The native reference provides
examples and exact library interfaces; not all are available in the browser.

[Mathematics](../language-guide.md#101-math) ·
[linear algebra](../language-guide.md#1011-linalg) ·
[physics and units](../language-guide.md#1012-physics-and-dimensioned-units) ·
[symbolic mathematics](../language-guide.md#1013-symbolic) ·
[all standard libraries](../language-guide.md#10-native-standard-library).

## Graphics and interfaces

`set`, `add`, `push` and `show` form the main graphics vocabulary; `append` and
`plot` are convenience forms. The available interface depends on the target.
This browser example uses `Frame.add`: edit the data to change the geometry.

<!-- live-example: examples/introduction/geometry.vkf -->

[HTML and CSS interfaces](getting-started.md#build-an-interface) ·
[graphics architecture](../adr/0001-ui-runtime-shared-memory-gpu.md) ·
[browser architecture](../adr/0004-browser-symbolic-kernel.md).

## Execution and measured performance

Lazy data access and parallel work when beneficial are design goals. The native
optimiser searches legal execution policies within a budget and checks results.
Those choices can trade compilation time for faster execution; they are not
universal speed guarantees.

[Execution-policy search and limits](execution.md) →
[VKF 0.3.0 benchmark summary against C, Rust and Zig](performance.md) →
[full native report and methodology](../../benchmarks/core-comparison/results/linux-x64-030.md).

Native measurements do not establish browser performance or results for another
compiler version.

[Complete language reference](../language-guide.md) ·
[style guide](../style-guide.md) · [Back to guide](guide.md)
