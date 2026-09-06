# Direct x64 concrete aggregate return accounting

Baseline: bootstrap `d3b030f8a965bc150b8b3e8fe72e0ae762e9b28a`.

This packet removes a direct-backend blocker exposed while assembling a
concrete `MachineModule`. Literal projection lowering previously emitted each
matching prefix field immediately. If a later required field was absent, the
helper declined projection after mutating the Machine IR value stack; ordinary
expression fallback then emitted the complete literal again.

## RED to GREEN

The strict public CLI regression uses the concrete nine-field MachineModule
shape and intentionally reaches ordinary structural fallback at the eighth
field. Before the fix it failed **1/2** with:

```text
direct x64 backend unsupported: unbalanced x64 machine IR function stack in make_module: 8
```

Projection eligibility is now checked completely before any instruction is
emitted. Ineligible projections therefore leave the shared Machine IR builder
unchanged and the existing fallback owns the whole emission. No x64-only
encoding path, return convention, public type, syntax, schema, API, ABI,
diagnostic contract, fallback policy, or optimizer policy changed.

Focused GREEN passed **2/2**, including execution of the returned concrete
aggregate (`23`). The real parser cursor suite passed **4/4**. The expanded
locked checkpoint passed **36/36** across bounded serial invocations: private
parser/type/Machine-IR/x64 parity, canonical source identities, executable
bundle production, Stage 1-to-Stage 2 artifact production, and the locked Stage
2 source-graph fixed point. The independent full executable-bundle repeat
passed **1/1**, 12621.8135 ms.

This fixes only transactional aggregate projection emission. General
parameter/argument arenas, function-body and entry `MachineModule` assembly,
control flow, collections, successor compiler production, generated-compiler
fixed point, fallback removal, and the exact I240 seed remain open. ADR-0005
stays conservatively 60% (delta 0).
