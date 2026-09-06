# Production-owned private UI compilation form

Base: main `505d84a2`. The retained effect representation is now owned by a
compiler-internal C++ module form rather than a separate test-only lowering path.
One lowering produces execution IR; stripping only compiler-generated effect
wrappers produces canonical IR. Non-UI compilations keep no second IR copy.
The original native `lower_value` entry remains unchanged and is an independent
canonical comparison in the new fixture.

`vkf_compile_source` stores the private form but serializes only its existing
`ok`/`typed_ir` response. The isolated test probe inspects that owned form instead
of lowering the AST again. No production export, schema, syntax, diagnostic,
runtime slot, bytecode instruction, or JavaScript adapter changes.

## Evidence

- New private-form tracer: **0/1 RED** before the private C++ form existed;
  **1/1 GREEN** after implementation. Canonical JSON matches original native
  lowering byte-for-byte; native/WASM inspection forms match and preserve the
  two add sites on opposite sides of the binding update.
- Fresh private probes, all five prior effect-site prerequisites, seven UI
  frontend cases, alias diagnostics, and module/cache/JSON/test-selection/call
  contracts: **37/37 GREEN**.
- Existing named/output/scope/call/spread/tuple/list/vector/logic and non-math
  public-boundary gate: **91/91 GREEN**.
- Fresh strict native compiler: **451 passed, 0 failed**.
- Full native/WASM gate: **133/451**, **318 failures**, zero discovery errors.
  Exact comparison with the record checkpoint: **451 entries, zero differences**
  in source hashes, native results, WASM results/diagnostics and outcomes.

There are no skips or weakened gates. The prior native captured-tuple display
RED remains unresolved; this packet does not change display policy. The missing
spectral header remains an independent expanded-evaluator blocker.

## Explicit runtime limit

This is an execution-information prerequisite, not proof that UI runs.
`vkf_emit_program` still consumes canonical IR. `Display<2>` remains the first
UI execution frontier; no geometry is fabricated, no `ui_program` metadata is
replayed and no language values are exposed to JavaScript.

Next, consume actual ordered effect operands in private native/WASM runtime
probes, then feed existing compiler-owned curve/scene packing. Preserve native
schema 23 and its public 37-slot runtime contract. Existing PE-private slots
37–39 are an audit lead, not authorization to change their contract or a proof
that a portable UI hook exists. Any unavoidable public change needs its own
ready-for-human decision packet.

## Artifact identities

- Production WASM: `c877190d8d2a241742242a46d9b043fb5c6f43ef23c822e575a5962f7aa2937d`
- Private probe WASM: `0ecad0cc5fa040a5f1ffa016616d1a5bb16a5b80b32960e739dbdde88daee75d`
- Fresh native strict: `1af1c3344dd7637610902f1f301b197d8c1d4fd3f99b7de049a86d7862827131`

Run in `vkf-trig-toolchain:14`, repository mounted at `/src`:

```sh
make --file=scripts/shared-compiler.mk --jobs=2
make --file=scripts/shared-ui-probe.mk --jobs=2
cmake --build build/native-compiler-docker --target vkf_strict --parallel 2
build/native-compiler-docker/bin/vkf-strict -t tests/vkf
node --test tests/bootstrap/shared-ui-compilation-form.test.mjs tests/bootstrap/shared-ui-effects.test.mjs tests/bootstrap/shared-ui-frontend.test.mjs tests/bootstrap/shared-ui-handle-alias.test.mjs tests/bootstrap/shared-module-linker.test.mjs tests/bootstrap/shared-module-snapshots.test.mjs tests/bootstrap/packaged-module-sources.test.mjs tests/bootstrap/shared-json-roundtrip.test.mjs tests/bootstrap/native-stdlib-cache-precision.test.mjs tests/bootstrap/shared-test-suite.test.mjs tests/bootstrap/shared-frontend-wasm.test.mjs tests/bootstrap/shared-call-binding-plan.test.mjs
node --test tests/bootstrap/shared-named-variadic-execution.test.mjs tests/bootstrap/shared-tuple-execution.test.mjs tests/bootstrap/private-tuple-bytecode.test.mjs tests/bootstrap/shared-host-output-boundary.test.mjs tests/bootstrap/shared-console-parity.test.mjs tests/bootstrap/shared-stdout-formatter.test.mjs tests/bootstrap/shared-scope-execution.test.mjs tests/bootstrap/shared-call-execution.test.mjs tests/bootstrap/shared-variadic-call-execution.test.mjs tests/bootstrap/shared-record-argument-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-vector-arithmetic.test.mjs tests/bootstrap/shared-list-construction.test.mjs tests/bootstrap/shared-scalar-logic.test.mjs tests/bootstrap/shared-trig-public-boundary.test.mjs
node tools/verify-native-wasm-tests.mjs --output=docs/evidence/shared-ui-compilation-form-native-wasm-2026-09-06.json
node tools/compare-native-wasm-evidence.mjs docs/evidence/shared-record-update-native-wasm-2026-09-06.json docs/evidence/shared-ui-compilation-form-native-wasm-2026-09-06.json docs/evidence/shared-ui-compilation-form-suite-comparison-2026-09-06.json
```

The full suite exits nonzero for the 318 preserved failures; its exact comparison
exits zero. The public-boundary test uses the previously preserved pre-trig snapshot.
