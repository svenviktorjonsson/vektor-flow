# A small core, room to build

Write the calculation. Shape the data. Make it visible. VKF brings those tasks
together without requiring a different programming model for each one.

The examples marked **Run in browser** below are editable and execute locally.
No compiler installation or compilation server is needed. The browser currently supports a subset of VKF; the native
compiler supports more.

## Functions that work through vectors

Define the operation once. Apply it to a value, a vector or nested vectors.
You do not need to rewrite it as an array-specific function.

<!-- live-example: examples/introduction/vector-functions.vkf -->

Vector lifting descends through vector layers; it does not search records or
tuples for fields. [The exact function-application rules](../language-guide.md#4-automatic-vector-function-application)
explain matching, conversions and overloads.

## Say how the data combines

Matching axes work element by element. Different axes form outer products.
The same rule carries from a short vector to a tensor.

<!-- live-example: examples/introduction/named-axes.vkf -->

This is part of the language, not an extra array library.
[Explore vectors and axes in the reference](../language-guide.md).

## A few concepts, useful shorthand

VKF is built around operators, types, functions and scopes rather than a
catalogue of control-flow keywords. Values and explicit rebinding keep the
programmer away from manual pointer management. Shortcuts make common patterns
convenient without adding a separate conceptual model.

Your own mathematical types can define binary operators as functions, rather
than a family of specially named methods.
[Bindings, control flow and operator definitions](../language-guide.md) give the
precise rules and native examples.

## Mathematics to graphics

Numerical and symbolic mathematics sit alongside linear algebra, physics and
units. Graphics follow the same philosophy: general operations over structured
data, rather than a new function for every picture.

Here is a complete, editable example. Change the coordinates, then run it again.

<!-- live-example: examples/introduction/geometry.vkf -->

The graphics vocabulary centres on `set`, `add`, `push` and `show`, with
convenience forms such as `append` and `plot`. The available surface depends on
the target and version; the example above uses the browser-supported `Frame.add`.
[Mathematical libraries](../language-guide.md) and
[the graphics architecture](../adr/0001-ui-runtime-shared-memory-gpu.md) go deeper.

## Familiar design skills

Use HTML and CSS to design interfaces, and VKF for behaviour, calculations and
visualisation. You do not have to relearn layout and styling to build a VKF
application. The compiled HTML/CSS application runtime is currently a Windows
native capability, not a promise that every UI program runs in this browser.

[Inspect a small HTML/CSS application](../../examples/ui_plot_card/app.vkf),
its [HTML](../../examples/ui_plot_card/ui/main.html) and
[CSS](../../examples/ui_plot_card/ui/theme.css).

## Let the compiler consider the execution

The aim is to describe the work without manually managing when to load every
value or where to parallelise it. Laziness and beneficial parallel execution
belong in that design—not in a separate framework the programmer must fit.

The existing native optimiser searches alternative execution policies within a
budget and checks their results. That is not a guarantee that every operation,
library or browser program is lazy or parallel.
[Execution-policy search and its limits](execution.md) explain the distinction.

## Performance, with context

Use measurements, not a universal speed claim. The published native comparison
is **VKF 0.3.0 against C, Rust and Zig**, on the same machine and workloads.
It does not measure the browser runtime or the newer compiler work.

[See the short benchmark comparison →](performance.md)

## Keep going

[Full language reference](../language-guide.md) covers the language and standard
libraries with examples. [Style guide](../style-guide.md) covers the compact forms.

[Download, use the CLI and host the browser runtime →](../../INSTALL.md)

[Why Vektor Flow exists](origins.md) tells the longer story.
