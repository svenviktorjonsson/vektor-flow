# General cursor collection-expression lowering

Baseline: bootstrap `f60b7fd60d431460718fac330a46128f4796d4c3`.

The collection tracer now carries a nested scalar operation through the same
general cursor and concrete MachineModule path:

```vkf
:: combine(cpu_count(), cpu_count() * 2, [1, cpu_count() * 2, 3])
```

## RED to GREEN

The strict-CLI RED failed because the MachineModule assembler had no overload
for per-element kind, name, and operator arenas. A direct-x64 follow-on RED
reported an unknown block-local `element_index` binding.

GREEN introduces a concrete scalar-expression record reused by top-level and
collection arguments. A delimiter-aware token-range arena preserves the three
source-ordered elements and the nested `cpu_count() * 2` operation. Constant
collections retain the literal-byte path; mixed expressions emit scalar
instructions followed by `make_owned_f64_list`. The entry assembler tracks
actual stack depth and records the five-slot peak instead of assuming call
arity equals aggregate construction width. No fixed element count, `any`
adapter, or legacy transform was added.

Focused cursor coverage passed **4/4**, 19100.0227 ms. Final affected bundle,
source-identity, cursor, Stage 1 artifact, and Stage 2 group passed **9/9**,
52535.2986 ms. Remaining locked parity passed **27/27**, 113825.3243 ms;
together the checkpoint is **36/36**. Independent executable-bundle repeat
passed **1/1**, 12314.6144 ms.

No public syntax, semantics, API, ABI, schema, diagnostic contract, fallback,
timeout, assertion, or optimizer policy changed. Native and WASM continue to
share the concrete typed/Machine IR path.

Nested collection values, general collection operations, broader nested
control flow, loops, full compiler-module parsing, successor compiler
production, generated-compiler fixed point, fallback removal, and the exact
I240 seed remain open. ADR-0005 stays conservatively 60% (delta 0).
