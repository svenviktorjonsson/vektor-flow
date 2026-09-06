# Concrete two-argument MachineModule assembly

Baseline: bootstrap `5f8e5ec8470284cae67268454e1fed430ec5fb6e`.

This tracer extends the general tagged cursor path from one parameter and one
argument to a two-parameter declaration and a mixed nested-call/literal call:

```vkf
twice(value:num, unused:num):
    1
    value * 2
:: twice(cpu_count(), 7)
```

## RED to GREEN

The strict public-CLI tracer first failed **0/1** because the concrete argument
arena had no typed payload for `second_argument.has_value`. Subsequent backend
REDs exposed string-valued conditional selection, a loop-local token-kind
binding, and string `length()` as unsupported in direct x64 lowering. Each was
fixed in the shared typed/Machine IR implementation; no backend-only bypass was
introduced.

GREEN recursively constructs parameter rows from declaration arity and scans
the original function-header token range for every parameter name/type pair.
The argument arena preserves call order, position, and the exact numeric value
`7`. Concrete MachineModule assembly emits the second argument before the
resolved call, records both parameters, derives the call instruction index from
arity, and uses the correct two-parameter provided mask (`3`). The older
one-argument resolved-call helper is absent from this tracer.

Focused direct-x64 GREEN passed **1/1**, 5753.7231 ms. Final affected cursor,
bundle, and Stage 2 verification passed **9/9**, 54340.1229 ms. The remaining
locked parity group passed **27/27**, 106208.6338 ms; together the checkpoint
passed **36/36** across bounded serial invocations: parser/direct
backend parity, private expression/type/record/x64 parity, executable bundle
production, Stage 1 artifact production, and locked Stage 2 source-graph fixed
point. Independent full executable-bundle repeat passed **1/1**, 12553.6552 ms.

No public syntax, semantics, API, ABI, schema, diagnostic contract, fallback,
timeout, assertion, or optimizer policy changed. The concrete typed and Machine
IR records remain shared by native and WASM consumers.

This closes the concrete two-parameter and two-argument tracer only. Arbitrary
argument-expression lists, general function signatures, control flow,
collections, full compiler-module parsing, successor compiler production,
generated-compiler fixed point, fallback removal, and the exact I240 seed remain
open. ADR-0005 stays conservatively 60% (delta 0).
