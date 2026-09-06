# Concrete declaration and call resolution

Baseline: bootstrap `55ae7dd8083aa40b45926a2356859a6ef509164c`.

This tracer advances the module-wide concrete typed arena through semantic
function registration, nested call resolution, and concrete output-call
Machine IR for the existing general-cursor module.

## RED to GREEN

The public strict-CLI tracer first failed **0/1**, exit 1, 3888.9242 ms:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

GREEN scans arbitrary module node counts and registers every supported numeric
function declaration in a fixed-width numeric table. User call targets are
found by table scan, not by branching on `twice`. Function bodies must contain
resolved concrete scalar expressions before their `num` return fact is
registered. The imported `system` module is recorded explicitly and gates
resolution of the existing `cpu_count: fn()->int` intrinsic.

The output node remains explicitly `unresolved` until resolution. The resolved
call carries `twice: fn(num)->num`, nested `cpu_count: fn()->int`, final `num`
type, node order, and exact span `5:1` through `5:21`. Concrete call MIR then
contains `call cpu_count`, `call twice`, and `return_f64`, with exact argument
and result counts. No heterogeneous `any` call adapter is used.

Focused GREEN passed **1/1**, exit 0, 5964.1687 ms. The complete real-cursor
suite passed **4/4**, exit 0, 18724.5012 ms.

## Regression

The locked serial checkpoint passed **33/33**, exit 0, 157383.816 ms. It
includes private parser/type/Machine-IR/x64 coverage, canonical source and
bundle identities, executable bundle gates, Stage 2 artifact production, and
the locked Stage 2 source-graph fixed point. The independent full-bundle repeat
passed **1/1**, exit 0, 13097.9174 ms.

No public language, syntax, semantics, API, ABI, schema, diagnostic, fallback,
timeout, assertion, or optimizer policy changed.

This tracer supports the existing one-parameter numeric declaration shape and
the already-defined `system.cpu_count` intrinsic. General arity, overloads,
other imports and calls, collections, control flow, full compiler-module
parsing, successor compiler production, generated-compiler fixed point,
fallback removal, and the exact I240 seed remain open. ADR-0005 stays
conservatively 60% (delta 0).
