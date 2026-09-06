# Shared compiler UI effects

Status: all five source-level prerequisites GREEN, including canonical retained
handle alias acceptance. The first WASM runtime slice (ordinary add/update/add)
is also GREEN through a private packet extractor; it executes the emitted
program, evaluates operands at each effect site, and builds retained-scene
packets from WASM memory. This is not yet production UI execution. Receipts:
[initial private frontend](../evidence/shared-ui-private-frontend-2026-09-05.md)
and [alias production parity](../evidence/shared-ui-handle-alias-2026-09-05.md).
The production-owned C++ private compilation form is now verified separately:
[compilation-form receipt](../evidence/shared-ui-compilation-form-2026-09-06.md).
Public canonical responses are unchanged. See the
[first WASM runtime receipt](../evidence/shared-ui-runtime-effects-2026-09-06.md).
The production browser bridge, immutable snapshots under in-place mutation,
native effect execution, and the remaining four runtime fixtures are still
gates; retaining and privately extracting packets does not make UI examples
executable in the site.

Observed RED: all five tests fail on the current shared artifacts, with native
and WASM responses equal. The first four compile successfully but contain zero
body effect sites. Handle aliasing fails earlier with the existing diagnostic
`missing field value in UI handle`. This baseline was reproduced before the
private ordinary-add change. Build the isolated inspection artifact using
`make -f scripts/shared-ui-probe.mk --jobs=2` in `emscripten/emsdk:4.0.14`, after
the ordinary shared compiler build has generated its packaged stdlib header.
Then run `node --test tests/bootstrap/shared-ui-effects.test.mjs` in the Linux
build environment. The probe lives under `build/shared-ui-probe`; it does not
replace `build/shared-compiler` or add production exports/response fields.

## Boundary

No public VKF syntax, semantics, API, serialized schema, or UI ABI change.
The proposed effect node is compiler-private lowering data; do not add a new
public export contract. Native and WASM must both consume it. If exposing it
requires changing a public typed-IR contract, keep a private compilation form
instead or stop for a language-authority decision.

Use the shared parser/type checker and actual runtime values. No source
rewrites, pattern matching, metadata-expression reevaluation, JavaScript
simulation, or fallback output. Existing retained-scene arena packing remains
the transport contract.

## Why the current representation is insufficient

`vkf_ast_to_ir_smoke.cpp` preserves named-argument source order near line 4026,
but retained constructors/methods replace calls with constants near lines
4165, 4407, 4413, 4568, 4599, and 4642. `ui_program.operations` retains typed
expressions, but its property maps lose argument order and its operation list
does not identify conditional/runtime execution sites. Executing that list
after the body would read later variable values and execute untaken calls.

## Internal implementation

1. At each original call site, produce an explicitly effectful private node:
   `retained_ui_effect`, `operation_index` (or `display_id`), ordered
   `arguments:[{name,value}]`, `result`, and `type`. The result is the existing
   handle/null value. Never hide effects on an ordinary `const` node.
2. Static handle registration unwraps only this compiler-owned result. Handle
   aliases resolve an existing binding; they do not copy its initializer.
   Inferred dimensions propagate through the result and wrapper together.
3. Both target lowerings evaluate ordered operands once at that expression
   position, then execute a private UI-effect instruction/hook. A failed
   operand prevents later operands and that operation. Control flow controls
   whether the instruction executes; metadata does not drive execution.
4. Runtime state resolves displays/frames/layers by the existing identities.
   The u-curve path passes evaluated numeric vectors to `build_u_curve` in
   `vkf_compiled_geometry_packet.hpp`. Capture owned values or pack immediately
   so subsequent mutation cannot alter earlier output. Reject unsupported
   operations clearly; do not silently omit them.
5. Keep UI events separate from console output. Reset execution-owned output
   for each run. Thin host rendering consumes supplied geometry/labels only.

Implementation seams: frontend handle registration near line 2730 and
dimension propagation near 2014; WASM `lower_expression` in
`vkf_wasm_bytecode_lowering.hpp` near 776; native expression validation,
effect analysis, and lowering in `vkf_compiler_artifact_smoke.cpp` and
`vkf_machine_ir_lowering.hpp`. Neither optimizer may discard or duplicate
the effect as a constant. Recheck source locations before editing.

## RED fixtures and execution acceptance

`tests/bootstrap/shared-ui-effects.test.mjs` sends identical authored source
through test-only native and WASM frontend probes. Their `execution_ir` field
is compiled only with `VKF_PRIVATE_UI_EFFECTS_TEST_PROBE`, never exposed by
production `vkf_compile_source`. Each accepted fixture also compares canonical
native/WASM production responses and verifies that erasing private wrappers
restores the complete original typed IR and metadata. It checks necessary
execution-site structure only; it does not interpret IR or fabricate events.

| Fixture | Required native and WASM runtime result |
| --- | --- |
| Add, update `y`, add again | First packet owns original 101 y samples; second owns each sample plus one. Both x vectors remain unchanged. |
| `y_u:mark(1,y), x_u:mark(2,x)` | Console emits `1` then `2`, each once; exactly one geometry add follows both operands. |
| Out-of-range first operand, later `mark(2,x)` | Same existing native bounds diagnostic; no later marker and no geometry add. Do not invent diagnostic wording. |
| False conditional add followed by unconditional add | Only the unconditional add executes. |
| `alias: frame`, then `alias.add(...)` | One display, one frame creation, one add; aliasing does not replay creation. |

Make one vertical slice GREEN at a time, beginning with ordinary add/update/add.
Use an internal native/WASM runtime probe to observe actual effects without
creating a public debugging API. Add direct execution assertions before
claiming these behaviors work. Also verify repeated runs reset state, exact
source-order errors, immutable earlier vector snapshots, identical geometry
arena bytes for identical inputs, and native/shared regression gates. Preserve
all existing tolerances, timeouts, and acceptance gates.
