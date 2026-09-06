# Real parser numeric-function typed handoff

Baseline: bootstrap `f62f2c2cd5f6a4158cdd76bf763bf3ebf596ba7e`.
This tracer extends the real self-hosted `parse_module_from_cursor` path from a
numeric binding to the canonical numeric function declaration and call:

```vkf
: .system
twice(value:num):
    value * 2
:: twice(cpu_count())
```

The public strict compiler CLI executes the runtime-produced 26-token tape
through a concrete internal parser cursor, the existing declaration-call
grammar validator, and the existing typed function/application lowering.

## RED to GREEN

The strict CLI test first called the absent tape-cursor parser route. RED was
**0/1**, exit 1, 1829.9081 ms total, with the existing direct-backend boundary:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

GREEN adds `TaggedTapeParseCursor` and a concrete
`TaggedNumericFunctionCursorModule`; it does not route the heterogeneous token
values through `any`. The parser reuses `parse_tagged_numeric_function_call`,
retains declaration-before-call order, and carries the exact declaration span
`2:1` through `3:13` plus call span `4:1` through `4:21`. The existing typed
adapter receives the parsed function name, parameter name, and factor, then
constructs the typed `fn(num)->num`, multiply body, `cpu_count()` argument, and
function call. The legacy cursor constructor gained an explicit `ParseCursor`
return annotation so its one-argument overload stays statically resolvable.
Focused GREEN passed **1/1**, exit 0, 2949.4215 ms. All three real-cursor
tracers passed **3/3**, exit 0, 8152.8471 ms.

## Regression

The expanded locked serial checkpoint passed **32/32**, exit 0,
156312.6616 ms. It includes the private parser/type/Machine-IR/x64 chain,
source graph identities, executable bundle gates, Stage 2 artifact production,
and the locked Stage 2 source-graph fixed point. A separate full-bundle repeat
passed **1/1**, exit 0, 12616.3343 ms. The graph/bundle/Stage 2 subset passed
**4/4**, exit 0, 12504.4425 ms. `git diff --check` passed.

No public language, syntax, semantics, API, ABI, schema, diagnostic, fallback,
timeout, assertion, or optimizer policy changed. Browser artifacts were not
deployed.

This closes one real-cursor function-declaration/call handoff into typed IR.
General module iteration, arbitrary declarations and expressions, JSON
decoding, generic AST replacement, successor compiler production,
generated-compiler fixed point, fallback removal, and the exact I240 seed
remain open. ADR-0005 stays conservatively 60% (delta 0).
