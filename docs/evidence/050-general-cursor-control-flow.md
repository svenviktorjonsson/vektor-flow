# General cursor control-flow lowering

Baseline: bootstrap `e97340177a5a1113c9a5a0244b7baf7316d213f8`.

This tracer extends the same general cursor, concrete typed arenas, and
MachineModule assembler with nested conditional control flow:

```vkf
combine(first:num, second:num, third:num):
    first > 0?
        @: 1
    @: 0
:: combine(cpu_count(), cpu_count() * 2, 7)
```

## RED to GREEN

The public strict-CLI RED compiled but the generated invariant process exited
**3** because conditional and return lines still reached the expression-only
statement path. A later direct-x64 RED reported that the concrete instruction
record had no branch-label field.

GREEN classifies conditional and return statements in the general parser,
decodes `GT`, and preserves the existing indentation-derived ownership graph:
six statements, a function block with two children, and a conditional block
with one nested return. A recursive concrete function-body arena yields the
three source-ordered body nodes without fixed node arity. Typed nodes preserve
`if_stmt`, `return`, `GT`, `0`, `1`, depths, parents, and spans.

The shared concrete instruction record now includes branch labels. The body
assembler iterates parallel statement arenas and lowers the verified branch to
`load_local`, `push_f64`, `ordered_greater_f64`, `jump_if_false`, nested
`return_f64`, `label`, and final `return_f64`. Existing general argument arenas
remain active in the same tracer; scalar call/binary/literal dispatch coverage
is retained. No standalone legacy conditional builder or `any` adapter is used.

Focused cursor suite passed **4/4**, 18850.3353 ms. Final affected parser,
source-identity, bundle, and Stage 2 group passed **9/9**, 52315.2457 ms. The
remaining locked parity group passed **27/27**, 108295.1139 ms; together the
checkpoint is **36/36**. Independent executable-bundle repeat passed **1/1**,
12859.1971 ms.

No public syntax, semantics, API, ABI, schema, diagnostic contract, fallback,
timeout, assertion, or optimizer policy changed. Native and WASM continue to
share the concrete typed/Machine IR path.

This closes the exercised conditional/return branch only. General nested
condition trees, loops, collections, full compiler-module parsing, successor
compiler production, generated-compiler fixed point, fallback removal, and the
exact I240 seed remain open. ADR-0005 stays conservatively 60% (delta 0).
