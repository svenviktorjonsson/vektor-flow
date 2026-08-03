# ADR 0004: Browser Symbolic Kernel Is Compiled VKF

Date: 2026-07-29

## Status

Accepted.

## Context

Interactive products need to compile expressions entered at runtime, generate
LaTeX, evaluate them against changing coordinates, classify plot forms, and
feed GPU rendering without a server round trip.

The self-hosted frontend already lowers VKF source through lexer, parser, and
typed IR. The current WASM emitter only supports a narrow static update subset.
Adding a second expression parser in JavaScript or using the Python frontend in
the browser would duplicate language semantics and contradict ADR 0003.

## Decision

The browser symbolic kernel is authored in VKF and compiled by the self-hosted
VKF compiler.

The compiler path is:

`VKF source -> typed IR -> deterministic bytecode -> WASM runtime`

The deep modules are:

- `WasmTypedModule`: validates the typed-IR module and owns type aliases,
  functions, runtime bindings, and source ordering.
- `WasmBytecodeModule`: owns constants, instructions, function metadata, and
  control-flow validation.
- `SymbolicKernel`: VKF-authored tokenization, parsing, diagnostics,
  classification, LaTeX generation, and evaluation.
- `SymbolicWasmTextChannel`: browser adapter for UTF-8 input and output only.

The UTF-8 memory interface is the browser seam. JavaScript may instantiate the
module, transfer bytes, and decode structured results. It must not parse,
classify, evaluate, repair, or render mathematical syntax.

Mixed authoring is represented by `SymbolicDocument`. The kernel preserves
exact source spans, classifies executable mathematical islands, emits one
KaTeX math-mode string, and retains opaque KaTeX presentation spans that are
not executable. Product profiles may define identifier decomposition such as
Platonic Play's `xy -> x*y`. Consumers render `latex` and execute only the
returned document program; they must not reconstruct either from spans in
JavaScript.

The WASM runtime owns dynamic values, program handles, diagnostics, and
evaluation results. Generated plot data is written to shared arenas so renderer
adapters can update GPU buffers without JSON on the frame path, consistent with
ADR 0001.

## Release Capability

The browser kernel release supports:

- decimal and complex numbers, two-dimensional vectors, `pi`, `r`, and `phi`
- symbolic variables including `x`, `y`, `z`, and `t`
- unary, arithmetic, comparison, equality, tuple, set, and function-call syntax
- named function definitions that later definitions may reference
- deterministic diagnostics and canonical LaTeX generation
- evaluation in global, vertex-local, edge-local, and face-local coordinates
- program handles that remain inside WASM and can be reevaluated without parsing
- plot classification for literals, point sets, linked tuples, explicit curves,
  parametric curves, implicit curves, inequalities, scalar fields, vector
  fields, and time-dependent curves
- shared numeric plot arenas suitable for direct GPU-buffer updates

JavaScript may choose a product coordinate context, colors, clipping geometry,
and GPU presentation. It may not parse, classify, evaluate, or repair symbolic
source.

The grammar and plot classifications extend this same VKF module and bytecode
interface. They never add product-local parsers.

## Consequences

- The browser has one symbolic implementation.
- Product code consumes compiled results and owns product semantics only.
- Python remains a bootstrap and test adapter, never a shipped runtime
  dependency.
- JavaScript tests may mock the WASM interface, but a release requires an
  end-to-end generated WASM test.
- WASM compiler work must deepen the typed-module and bytecode modules rather
  than add symbolic-specific branches to the artifact emitter.
- A release is incomplete until the generated kernel artifact and its manifest
  are present in the package and reproduced byte-for-byte in CI.
