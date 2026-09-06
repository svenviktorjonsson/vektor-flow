# General token-range call arenas

Baseline: bootstrap `0d7820fe207033ecc4cbcf68a481ae670c43b427`.

This tracer removes the fixed one/two-argument payload from the concrete typed
handoff. The public strict CLI compiles a three-parameter function called with
a nested call, a nested-call binary expression, and a literal:

```vkf
combine(first:num, second:num, third:num):
    1
    first * 2
:: combine(cpu_count(), cpu_count() * 2, 7)
```

## RED to GREEN

RED passed compilation but the generated tracer exited **3** because the old
arena could not represent the third argument. The next direct-x64 RED named the
obsolete `argument.callee` aggregate projection, proving the fixed physical
record remained in the lowering path.

GREEN finds the outer call parentheses, tracks nesting depth, and splits only
depth-one commas into inclusive token-range rows. The verified rows are
`[30..32]`, `[34..38]`, and `[40..40]`, in source order. Indexed access classifies
them as `call`, `binary_op`, and `const`, preserving `cpu_count`, `STAR`, `2`,
and `7`. Declaration signature identity is generated from arity rather than
one/two-parameter branches. Concrete MachineModule lowering consumes parallel
dynamic argument arenas, computes the provided-parameter mask by iteration,
and copies all parameter names through one loop. No third-value field, fixed
arity overload, `any` adapter, or legacy call lowering participates.

Focused direct-x64 GREEN passed **1/1**, 5870.0555 ms. Final affected cursor,
source-identity, bundle, and Stage 2 group passed **9/9**, 56430.5555 ms. The
remaining locked parity group passed **27/27**, 116126.0508 ms; together the
checkpoint is **36/36**. Independent executable-bundle repeat passed **1/1**,
15287.8879 ms.

No public syntax, semantics, API, ABI, schema, diagnostic contract, fallback,
timeout, assertion, or optimizer policy changed. Native and WASM continue to
share the concrete typed/Machine IR path.

This closes nesting-aware argument-list storage and the exercised call/binary/
literal lowering only. General expression trees, control flow, collections,
full compiler-module parsing, successor compiler production, generated-compiler
fixed point, fallback removal, and the exact I240 seed remain open. ADR-0005
stays conservatively 60% (delta 0).
