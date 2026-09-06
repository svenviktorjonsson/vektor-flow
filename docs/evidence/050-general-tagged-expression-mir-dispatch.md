# General tagged expression typing and Machine IR dispatch

Baseline: bootstrap `782bf345cbedcd22e5d0f45a01152f0a9e5bd715`.

This tracer sends two different expression shapes through one general
`TaggedCursorModule` block:

```vkf
: .system
twice(value:num):
    1
    value * 2
:: twice(cpu_count())
```

The parser preserves both children in source order under the same function.
The typed handoff replaces the expression path's structural `any` with one
uniform concrete tagged scalar representation. Its `kind` discriminates
`const` from `binary_op`; all physical fields, type, order, nesting, and span
remain concrete. Machine IR dispatches on that discriminant through one
internal interface.

## RED to GREEN

The new public strict-CLI tracer first failed **0/1**, exit 1, 3752.4469 ms:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

The first cross-module whole-aggregate handoff exposed nominal module-local
types and was rejected rather than weakened to `any`. The final boundary passes
the concrete tagged scalar fields explicitly. The backend also rejected a
dynamic instruction-vector repeat layout, so the internal MIR result uses the
existing fixed four-cell tagged instruction arena plus an authoritative
instruction count. Constants use two cells; binary operations use four. This
is internal storage, not a public schema or ABI.

Focused GREEN passed **1/1**, exit 0, 4451.1924 ms. It verifies exact AST order,
parentage, constant span `3:5` through `3:5`, binary span `4:5` through `4:13`,
concrete `num` types, constant `push_f64`/`return_f64`, and binary
`load_local`/`push_f64`/`multiply_f64`/`return_f64`. The complete real-cursor
suite passed **4/4**, exit 0, 15768.2629 ms.

## Regression

The expanded locked serial checkpoint passed **33/33**, exit 0,
158144.9769 ms. It includes private parser/type/Machine-IR/x64 coverage,
canonical source and bundle identities, executable bundle gates, the Stage 2
artifact, and the locked Stage 2 source-graph fixed point. The independent full
bundle repeat passed **1/1**, exit 0, 13073.9371 ms.

No public language, syntax, semantics, API, ABI, schema, diagnostic, fallback,
timeout, assertion, or optimizer policy changed.

This closes structural `any` only for the concrete tagged scalar-expression
handoff. Generic module-wide typed arena assembly, declarations, calls,
collections, control flow, JSON decoding, successor compiler production,
generated-compiler fixed point, fallback removal, and the exact I240 seed remain
open. ADR-0005 stays conservatively 60% (delta 0).
