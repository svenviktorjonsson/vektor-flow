# Shared compiler integration inventory

2026-09-05, dirty `main`; root owns review, staging and integration. No staging
or commit was performed for this inventory. All GREEN results below are against
the **assembled dirty stack**, not proof that hypothetical intermediate commits
build. Shared files require dependency-aware hunk separation and retesting after
each packet; never stage whole overlapping files to approximate this plan.

Compiler artifacts remain frozen at production WASM SHA256
`095fefccbc86af69d4f41ab739aeb024d2c5052f9d30ed91115d358dfe1ecd33`
and native SHA256
`639ccbc5fd0a2560785c798dc8cd6001b1a13bc6b5b345b26bfb93bca6911ea9`.
The native alias receipt proves 451/451 for that binary. No compiler build is
active. Audit/helper tests create only isolated test artifacts.

## 1. Shared foundation (first)

New `compiler/native/` helpers:
`vkf_module_linker.hpp`, `vkf_module_snapshots.hpp`,
`vkf_packaged_module_sources.hpp`, `vkf_value_layout.hpp`,
`vkf_test_suite.hpp`, `vkf_output_effects.hpp`, `vkf_stdout_format.hpp`,
`vkf_stat_semantics.hpp`, `vkf_math_primitives.hpp`,
`vkf_call_binding_plan.hpp`, `vkf_fixed_spread_plan.hpp`.

Native consumers must move with the extraction hunks in
`vkf_machine_ir_lowering.hpp`, `vkf_driver_artifact_smoke.cpp`,
`vkf_ast_to_ir_smoke.cpp`, and `vkf_x64_artifact.cpp`.
Preserve native local-stat storage, block-shadow initializer and ordered-print
fixes; do not separate their tests from the matching implementation.
`native/VfOverlay/vf/json.cpp` round-trip precision is a prerequisite to exact
frontend transport and geometry identity.

Generator: `tools/build-packaged-stdlib.mjs`.
Tests under `tests/bootstrap/`: `packaged-module-sources.test.mjs`,
`shared-module-linker.test.mjs`, `shared-module-snapshots.test.mjs`,
`shared-value-layout.test.mjs`, `shared-test-suite.test.mjs`,
`shared-output-effects.test.mjs`, `shared-stdout-formatter.test.mjs`,
`shared-call-binding-plan.test.mjs`, `shared-json-roundtrip.test.mjs`,
`native-stat-local-storage.test.mjs`, `native-ordered-print-effects.test.mjs`.
Fixtures: `tests/bootstrap/fixtures/{value-layout-probe.cpp,value-layout-native-oracle.json,stdout-formatter.cpp}`;
`tests/fixtures/{call_binding_plan_probe.cpp,json-roundtrip-probe.cpp}`.

**Blocking evidence discovered during inventory:** packaged-module and linker
canonical-IR tests are RED: linked full-precision `0.41421356237309503` differs
from native `--diagnostics` `typed-ir.json` value `0.414213562373095` (and other
math literals). This is not the sine-runtime defect. Determine the native
diagnostic serialization contract before changing production serialization or
weakening exact equality. All other helper gates listed below pass.

## 2. Shared execution / features (depends on 1)

Build/entry: `compiler/native/{vkf_browser_compiler.cpp,vkf_browser_host_policy.cpp,vkf_wasm_program_lowering.hpp,vkf_wasm_artifact_manifest.hpp}`;
`scripts/{build-shared-compiler.sh,shared-compiler.mk}`.
Execution changes: `compiler/native/{vkf_wasm_bytecode.hpp,vkf_wasm_bytecode_lowering.hpp,vkf_wasm_typed_ir.hpp,vkf_wasm_vm_emitter.hpp,vkf_symbolic_kernel_artifact.cpp}`.
Helpers: `vkf_wasm_default_call_thunk.hpp`, `vkf_wasm_record_argument_plan.hpp`,
`vkf_wasm_math_kernels.hpp`, `vkf_wasm_stat_kernels.hpp`;
`compiler/native/runtime/{vkf_pow_kernel.c,vkf_pow_kernel.generated.hpp,LICENSE-musl}`;
`tools/build-wasm-math-kernels.mjs`.

Within the overlapping lowerer: whole-program/output order and scopes first;
record layout/inference and calls/defaults next; numeric variadic/dynamic spread
then fixed/vector/record spread; list/scalar XOR and numeric/vector math/stat
packets next. They currently share helpers and native extraction hunks; root
must choose the smallest actually buildable boundaries, not promise standalone
GREEN for each label. No new argument scheduling semantics are approved.

Tests under `tests/bootstrap/`:
`shared-frontend-wasm.test.mjs`, `shared-compiler-execution.test.mjs`,
`shared-program-execution.test.mjs`, `shared-console-parity.test.mjs`,
`shared-scope-execution.test.mjs`, `shared-call-execution.test.mjs`,
`shared-default-call-thunk.test.mjs`, `shared-record-argument-plan.test.mjs`,
`shared-variadic-call-execution.test.mjs`, `shared-list-construction.test.mjs`,
`shared-scalar-logic.test.mjs`, `shared-math-builtins.test.mjs`,
`shared-stdlib-execution.test.mjs`, `shared-vector-lifting.test.mjs`,
`shared-vector-arithmetic.test.mjs`, `shared-source-math-lifting.test.mjs`,
`shared-stat-execution.test.mjs`, `shared-if-expression.test.mjs`,
`wasm-math-kernels.test.mjs`, `wasm-stat-kernels.test.mjs`.
Fixtures: `tests/bootstrap/fixtures/record-argument-plan.cpp`,
`tests/fixtures/default_call_thunk_probe.cpp`.

Compiler-owned geometry is a separate reviewed subpacket:
`compiler/native/{vkf_compiled_geometry_packet.hpp,vkf_retained_scene_arena.hpp,vkf_native_scene_lowering.hpp}`,
`tests/bootstrap/compiled-geometry-packet.test.mjs`,
`tests/fixtures/compiled_geometry_packet_probe.cpp`. Its helper gate does not
prove browser UI execution or authorize JavaScript interpretation.

## 3. Alias fix and private UI prerequisite (depends on 1–2)

Production alias-resolution hunks in `vkf_ast_to_ir_smoke.cpp` must land with
`tests/bootstrap/shared-ui-handle-alias.test.mjs`: same-kind scoped retained
binding only, alias stays `load`, invalid/shadowed parameters retain diagnostics.
Then private macro-only effect retention in that same file, guarded include and
response hook in `vkf_browser_compiler.cpp`, new
`compiler/native/vkf_private_ui_frontend_probe.hpp`, and
`scripts/shared-ui-probe.mk`.

Tests: `tests/bootstrap/{shared-ui-frontend.test.mjs,shared-ui-effects.test.mjs}`.
Plan/receipts: `docs/plans/shared-ui-effects.md`,
`docs/evidence/shared-ui-private-frontend-2026-09-05.md`,
`docs/evidence/shared-ui-handle-alias-2026-09-05.md`.
Verified: production alias 2/2, production frontend 7/7, private frontend 7/7,
private prerequisites 5/5, native 451/451. No public `execution_ir` field; private
canonical production JSON invariance remains asserted. No renderer claim.

## 4. Accepted A output-only boundary (depends on 2–3)

`web/playground/vkf-shared-compiler.mjs` now invokes emitted code directly and
passes opaque bytes to compiler-owned formatting; no `values`/host decoder.
Because it is currently untracked, its executable baseline and final boundary
are one file: root should integrate the final output-only version, not reintroduce
the superseded host-value form just to create an artificial intermediate commit.

New `tests/bootstrap/{shared-host-output-boundary.test.mjs,shared-native-output.mjs,shared-sine-output-determinism.test.mjs}`;
test migrations in shared math/discovery/stdlib/vector/stat tests listed above;
`tests/bootstrap/native-wasm-gate-outcomes.test.mjs` and
`tools/verify-native-wasm-tests.mjs` require actual stdout and reject `values`.
Decision: `CONTEXT.md`, `docs/adr/0004-browser-symbolic-kernel.md`,
`docs/plans/browser-tuple-transport-decision.md`.
Receipt: `docs/evidence/shared-host-output-boundary-2026-09-05.md`.

Verified boundary 3/3; assembled focused suite 86/86, plus stat 4/5 =90/91.
Exact sine is separately 0/1 RED. The migrated tolerances run as unchanged VKF
predicates and compare fresh native stdout/stderr. No tolerance normalization.

## 5. Evidence / gates / publication (last, does not waive RED)

`tools/{verify-browser-frontend-parity.mjs,verify-shared-documentation-execution.mjs,verify-native-wasm-tests.mjs}`;
`package.json`, `.github/workflows/{compiler-ci.yml,pages.yml}`;
`docs/HANDOVER-2026-09-05-shared-browser-compiler.md`;
call/record/variadic/fixed-spread/native-ordered-print receipts and all
`docs/evidence/native-wasm-suite-*-2026-09-05.json`,
`docs/evidence/native-wasm-suite-2026-09-05.json`,
`docs/evidence/shared-documentation-execution-*-2026-09-05.json`,
`docs/evidence/shared-frontend-wasm-parity-2026-09-05.json`,
`docs/evidence/{readme-editor-execution-2026-09-05.tap,shared-compiler-editors-2026-09-05.tap}`.
`docs/plans/call-argument-order-decision.md` stays pending.
Historical receipts must retain their exact artifact identities, not be relabeled
as current. The latest full language receipt is 119/451, not full coverage.

New audit-only packet: `tools/audit-shared-trigonometry.{mjs,py}`,
`docs/plans/shared-math-determinism-decision.md`,
`docs/evidence/shared-trigonometry-audit-2026-09-05.json`, this inventory.
No math policy approval follows from these files.

`web/documentation.mjs` and `tests/js/browser-compiler-runtime.test.mjs` are
existing root-owned published-site edits: review separately; this inventory
does not claim they wire the shared compiler. Never publish the replacement
until same-suite and every README edit/run/reset/UI acceptance gates pass.

## Exact verified GREEN commands

From `/src` in `emscripten/emsdk:4.0.14` (formatter requires `em++`):

```sh
node --test tests/bootstrap/shared-value-layout.test.mjs tests/bootstrap/shared-module-snapshots.test.mjs tests/bootstrap/shared-output-effects.test.mjs tests/bootstrap/shared-test-suite.test.mjs tests/bootstrap/shared-stdout-formatter.test.mjs tests/bootstrap/shared-call-binding-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-json-roundtrip.test.mjs tests/bootstrap/wasm-stat-kernels.test.mjs tests/bootstrap/compiled-geometry-packet.test.mjs
```

Fresh inventory run **38/38**, zero skips. A previous Node-only run lacked
`em++`; that environment failure was resolved by using the required toolchain,
not by weakening the formatter test. Packaged/linker REDs remain separate.

Node 22/g++: `node --test tests/bootstrap/wasm-math-kernels.test.mjs` **13/13**.
The full exact 86/86 focused command is the 90/91 command in the A-boundary
receipt with only `shared-stat-execution.test.mjs` removed. Run that stat file
separately and report its 4/5; never present exclusions as all-language GREEN.
Native: `build/native-compiler-docker/bin/vkf-strict -t tests/vkf` **451/451**
per the frozen alias receipt; rerun after every native-affecting commit.

## RED / pending decisions that integration must preserve

- `shared-stat-execution`: `capture_named` named rest remains unsupported.
- `shared-sine-output-determinism`: three formatted sine tokens differ.
- `shared-if-expression`: function-returned numeric conditional remains RED.
- Packaged/linker canonical typed-IR equality: native diagnostics precision RED.
- Full unchanged language suite: latest completed 119/451, 332 failures.
- Earlier effectful variadic native crash is unresolved, not validated by the
  passing non-effectful variadic tracers.
- Full retained UI/browser execution, tuple internals and every editable README
  example are not finished. Private frontend acceptance is not execution.
- **Arena resource-policy decision:** default `EmitOptions::arena_capacity` in
  `vkf_wasm_vm_emitter.hpp` is 1 MiB; native symbolic artifact explicitly requests
  64 MiB in `vkf_symbolic_kernel_artifact.cpp:238`; shared program emission uses
  the default. This is potentially observable capacity/failure behavior, not a
  harmless cleanup. First add boundary allocation tests measuring exact failures,
  manifest/memory effects and browser limits. Ask Viktor whether a common explicit
  64 MiB policy or a separately specified browser limit is intended. Do not silently
  change capacities, ABI/schema or diagnostics; do not reduce tests to fit 1 MiB.

Root should resolve contract-sensitive REDs or explicitly checkpoint them as
unfinished development before splitting; no clean-release claim is justified.
