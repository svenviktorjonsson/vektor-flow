# General tagged payload to typed expression and Machine IR

Baseline: bootstrap `e8b36766aaa883eb1b83b32aebb3bfd8f003c640`.

This tracer advances the general `TaggedCursorModule` path for:

```vkf
: .system
twice(value:num):
    value * 2
:: twice(cpu_count())
```

One per-kind-independent payload decoder walks each AST node's token range. It
preserves source order and exact token slices, decodes identifier, numeric, and
operator payloads, and supplies the function-body facts to concrete expression
typing and the existing numeric multiply Machine IR construction.

## RED to GREEN

The public strict CLI tracer first failed **0/1** with:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

The first general loop implementation then exposed a real direct-backend scope
boundary, `unknown binding token_kind`. GREEN makes numeric token offsets and
kind codes loop-stable and defers string slicing until the token walk is
complete. No fixed-token-count overload or statement-example branch was added.

The executable probe verifies `twice`, `value`, `num`, `STAR`, `2`, and
`cpu_count` payloads; a concrete `num` binary expression; exact body span
`3:5` through `3:13`; and payload-derived `load_local`, `push_f64 2`,
`multiply_f64`, and `return_f64` instructions. Focused GREEN passed **1/1**,
exit 0, 6998.6704 ms. All real-cursor tracers passed **3/3**, exit 0,
11440.0988 ms.

## Regression

The expanded locked serial checkpoint passed **32/32**, exit 0,
150081.0824 ms. It includes private parser/type/Machine-IR/x64 coverage,
canonical source and bundle identities, executable bundle gates, the Stage 2
artifact, and the locked Stage 2 source-graph fixed point. The independent full
bundle repeat passed **1/1**, exit 0, 11961.6519 ms.

No public language, syntax, semantics, API, ABI, schema, diagnostic, fallback,
timeout, assertion, or optimizer policy changed.

This is a general token-range payload decoder and a concrete numeric-expression
vertical tracer, not arbitrary expression or module lowering. The generic typed
cursor nodes still carry structural `any`; arbitrary declarations/expressions,
JSON decoding, generic AST replacement, successor compiler production,
generated-compiler fixed point, fallback removal, and the exact I240 seed remain
open. ADR-0005 stays conservatively 60% (delta 0).
