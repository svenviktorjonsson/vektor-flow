# General tagged module cursor

Baseline: bootstrap `0fb8779c73985bdaa84c8457f6184a4af5b8a6fa`.

This tracer replaces the numeric-function-specific one-argument cursor result
with one grammar-neutral tagged module iterator. A runtime-produced token tape
is scanned once to NEWLINE or EOF boundaries and represented as a uniform
numeric statement arena. The same interface therefore handles the canonical
module's import, function header, function body, and call without another
fixed-arity parser overload.

## RED to GREEN

The strict CLI test first required general statement access from the existing
function-specific cursor result. RED was **0/1**, exit 1, 1320.4138 ms, with:

```text
<driver-smoke>:1:1: automatic function broadcasting only descends through vectors
```

GREEN returns a concrete, self-contained `TaggedCursorModule` containing source,
the tagged token tape, and a seven-cell-per-statement index arena.
`tagged_module_statement` projects one concrete statement view by index. The
four source statements retain order `0,1,2,3`,
token counts `3,7,3,8`, and exact spans `1:1-1:4`, `2:1-2:17`, `3:5-3:13`,
and `4:1-4:21`. The module span remains `1:1-4:21`. The existing numeric
function validator consumes the iterated module source and original tape before
the existing typed function/application adapter runs. Its diagnostics and
typed-IR shapes are unchanged.

Focused GREEN passed **1/1**, exit 0, 2994.9149 ms. All three real-cursor
tracers also pass inside the locked checkpoint below.

## Regression

The locked serial checkpoint passed **32/32**, exit 0, 140070.5687 ms. It
includes the private parser/type/Machine-IR/x64 chain, source graph identities,
both executable bundle gates, Stage 2 artifact production, and locked Stage 2
source-graph fixed point. A separate full-bundle repeat passed **1/1**,
exit 0, 11663.1058 ms. `git diff --check` passed.

No public language, syntax, semantics, API, ABI, schema, diagnostic,
fallback, timeout, assertion, or optimizer policy changed. Browser artifacts
were not deployed.

This closes fixed-example module segmentation for the tagged tape cursor. AST
node construction for arbitrary statement kinds, indentation-aware block
nesting, JSON decoding, generic AST replacement, successor compiler production,
generated-compiler fixed point, fallback removal, and exact I240 seed remain
open. ADR-0005 stays conservatively 60% (delta 0).
