# Module-wide concrete typed arena

Baseline: bootstrap `4a6927ad1e92e2d9afce83e502a50bc004afbdff`.

This tracer replaces per-expression hand wiring with a module-wide concrete
arena for the existing general cursor source:

```vkf
: .system
twice(value:num):
    1
    value * 2
:: twice(cpu_count())
```

The parser now produces one general seven-cell numeric payload row per AST
node. The typed module owns source, token, node, block, and payload arenas and
returns one uniform concrete node representation for import, function,
constant expression, binary expression, and output call statements. No arena
field or concrete node payload uses `any`.

## RED to GREEN

The strict-CLI tracer first failed **0/1**, exit 1, 4008.9563 ms:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

GREEN packages arbitrary node counts rather than branching on this five-node
example. Accessors recover names, operator, numeric value, type state, order,
parent, and exact span from fixed-width arenas. The constant and binary nodes
then feed the existing concrete Machine IR kind dispatcher. Import and function
types are concrete; supported scalar expressions are `num`; unresolved call or
non-numeric binding types stay explicitly `unresolved` rather than being
guessed or represented as `any`.

Focused GREEN passed **1/1**, exit 0, 4974.5254 ms. The standalone real-cursor
suite passed **4/4**, exit 0, 16621.6266 ms. It proves five-node source order,
two-child function nesting, identifier payloads, constant span `3:5` through
`3:5`, binary span `4:5` through `4:13`, and both two- and four-instruction MIR
paths.

## Regression

The locked serial checkpoint passed **33/33**, exit 0, 154246.3793 ms. It
includes private parser/type/Machine-IR/x64 coverage, canonical source and
bundle identities, executable bundle gates, Stage 2 artifact production, and
the locked Stage 2 source-graph fixed point. The independent full-bundle repeat
passed **1/1**, exit 0, 12369.1155 ms.

No public language, syntax, semantics, API, ABI, schema, diagnostic, fallback,
timeout, assertion, or optimizer policy changed.

This removes structural `any` from the module-wide tagged arena used by this
cursor path. Semantic declaration tables, call resolution, collections,
control-flow nodes, full compiler-module parsing, successor compiler
production, generated-compiler fixed point, fallback removal, and the exact
I240 seed remain open. ADR-0005 stays conservatively 60% (delta 0).
