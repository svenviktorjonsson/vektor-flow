# Why Vektor Flow?

[Guide](guide.md) / Why

## Start with a few operations

I started with a function parser for a drawing program. A compiler could handle
functions too, so I began building a language. My first constraint was simply
**no keywords**: could operators, types, functions and scopes be enough?

`.` reaches in; `:` spills. `::` extends the idea to terminal output and user
input. The aim was consistent operations, not just replacing words with symbols.
Early versions became crowded. Making vectors central gave the design focus.

[Operator rules](../language-guide.md#7-operators-and-overloads) and
[scopes](../language-guide.md#9-modules-scope-and-dispatch).

## Write the calculation, not an array workaround

During my PhD work, I fought Python arrays to express the calculations I wanted.
I wanted an ordinary function to work elementwise through vectors without
writing another version of it.

Run this, then change `* 2` to `* 3`.

<!-- live-example: examples/introduction/vector-functions.vkf -->

[How vector function application works](../language-guide.md#4-automatic-vector-function-application).

## Fewer things to manage

Immutability with explicit rebinding keeps the value model clear without
requiring the programmer to manage pointers. I also wanted mathematical types
to define operators as binary functions, without a catalogue of special method
names or the complexity I encountered in C++.

[Values and rebinding](../language-guide.md#1-programs-and-bindings) and
[defining operators](../language-guide.md#73-operator-overloads).

Slow dataset loading and the effort of fitting Dask to my needs motivated lazy
data access and parallel execution when beneficial. These are execution-model
goals, not a promise that every target and library implements them identically.

[Execution-policy search and current limits](execution.md).

## Build graphics, not a catalogue of names

I wanted more freedom from fewer general graphics operations. The core centres
on `set`, `add`, `push` and `show`; `append` and `plot` provide convenient
shorthand. HTML and CSS already solve layout and styling, so those skills
should carry over rather than be replaced.

[Try the graphics example](getting-started.md#make-it-visible) and
[build an interface](getting-started.md#build-an-interface).

## The name and implementation

Vektor Flow describes vectors flowing through operations. It also carries my
name, **Viktor**, and my school nickname, **Flo**.

The implementation moved from Python translation to generated C++ and then
direct machine-code output. Self-hosting remains work in progress.
[Compiler architecture and self-hosting](../adr/0005-staged-self-hosting-and-direct-machine-code.md).

[How: get started →](getting-started.md) · [What: core ideas →](concepts.md)
