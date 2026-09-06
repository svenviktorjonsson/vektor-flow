# General cursor collection lowering

Baseline: bootstrap `5ee6dd81a23a3cccbfdafcad8fb81a81412242fa`.

This tracer extends the same general cursor, concrete typed arenas, and
MachineModule assembler with a vector-typed parameter and collection argument:

```vkf
: .system
combine(first:num, second:num, third:[num]):
    first > 0?
        @: 1
    @: 0
:: combine(cpu_count(), cpu_count() * 2, [1, 2, 3])
```

## RED to GREEN

The public strict-CLI RED exited **3** because commas inside the collection
were treated as outer call-argument separators and vector parameter types were
not represented by the concrete parameter arena. Subsequent direct-x64 REDs
reported an unknown loop-local binding and an incompatible aggregate width for
a mutable parameter-type temporary.

GREEN adds bracket depth to the general token-range argument splitter, decodes
the existing `[num]` type spelling from exact source bytes, and retains the
three numeric elements in a concrete `TypedTaggedArgument.values` arena. The
same source-ordered MachineModule assembler now consumes parallel parameter
type and collection-count arenas, emits exact IEEE-754 bytes through the shared
`_bootstrap_f64_bytes` path, and lowers the argument to
`make_owned_f64_list_literal`. Numeric-scalar parameter classification is
derived from the decoded parameter types. No fixed-arity collection helper,
legacy transform, or `any` adapter is used.

Focused cursor coverage passed **4/4**. Final affected bundle, source-identity,
cursor, Stage 1 artifact, and Stage 2 group passed **9/9**, 51488.5334 ms. The
remaining locked parity group passed **27/27**: **13/13**, 13195.779 ms, plus
**14/14**, 99529.4985 ms. Together the checkpoint is **36/36**. Independent
executable-bundle repeat passed **1/1**, 12975.5879 ms.

No public syntax, semantics, API, ABI, schema, diagnostic contract, fallback,
timeout, assertion, or optimizer policy changed. Native and WASM continue to
share the concrete typed/Machine IR path.

This closes the exercised flat numeric collection argument only. General
nested collection expressions, collection operations, broader nested control
flow, loops, full compiler-module parsing, successor compiler production,
generated-compiler fixed point, fallback removal, and the exact I240 seed
remain open. ADR-0005 stays conservatively 60% (delta 0).
