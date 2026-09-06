# Emitted record replacement checkpoint

Base: main `c293c887`. The private emitted-WASM record setter previously appended
every assignment. An existing key now retains its original slot; only a missing
key appends. The result remains a copied record, so earlier snapshots are not
mutated. Existing compiler-owned UTF-8 equality is reused. No opcode, value tag,
manifest, public parameter count, syntax, diagnostic, or JavaScript code changes.

## RED → GREEN and limits

The committed regression initially printed
`(points:[3, 4], label:original, points:[8, 4])` instead of native
`(points:[8, 4], label:original)`. It now matches native exactly.
A further test covers first/middle/last/repeated replacement, original snapshot
isolation, one RHS effect per update, field lookup and repeated-run reset.

- New record replacement tests: **2/2 GREEN**.
- Combined focused command: **92/93**, no skips. Its sole failure is the
  deliberately preserved native captured-tuple display defect. Existing named
  capture plus other compiler regressions remain **90/90 GREEN**.
- Public frontend/module/cache/JSON/test-selection/call-plan and non-math
  manifest/export boundary tests: **23/23 GREEN**.
- Unchanged native `vkf-strict -t tests/vkf`: **451 passed, 0 failed**.
- Full unchanged native/WASM suite: **133/451**, **318 failures**, zero discovery
  errors. Every source hash, native result, WASM result/diagnostic and outcome is
  identical to the named-capture checkpoint: **451 entries, zero differences**.
- Documentation execution smoke remains **46/87**, with **41 failures**. This
  does not establish exact output, graphics, edits/reset or release acceptance.

The separate native captured-tuple test remains RED: native prints `(pair:[1, 2])`
where emitted WASM preserves `(pair:(1, 2))`. No tuple-to-vector conversion or
native display-policy change was made to hide it. The missing spectral header
and effectful positional-variadic native crash also remain separate blockers.

## Identities and commands

- Shared WASM: `bd4ec699e88ccbe3432333d427cb7d47a46ce015e0f9374d69b8a7c3763f098c`
- Native strict (unchanged): `4728738922848fc7e5a94fc90e7492ce6648dcd5e460834bba75d140be68c360`

Run inside `vkf-trig-toolchain:14` with the repository mounted at `/src`:

```sh
make --file=scripts/shared-compiler.mk --jobs=2
node --test tests/bootstrap/shared-named-record-followups.test.mjs tests/bootstrap/shared-named-variadic-execution.test.mjs tests/bootstrap/shared-tuple-execution.test.mjs tests/bootstrap/private-tuple-bytecode.test.mjs tests/bootstrap/shared-host-output-boundary.test.mjs tests/bootstrap/shared-console-parity.test.mjs tests/bootstrap/shared-stdout-formatter.test.mjs tests/bootstrap/shared-scope-execution.test.mjs tests/bootstrap/shared-call-execution.test.mjs tests/bootstrap/shared-variadic-call-execution.test.mjs tests/bootstrap/shared-record-argument-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-vector-arithmetic.test.mjs tests/bootstrap/shared-list-construction.test.mjs tests/bootstrap/shared-scalar-logic.test.mjs
node --test tests/bootstrap/shared-trig-public-boundary.test.mjs tests/bootstrap/shared-module-linker.test.mjs tests/bootstrap/shared-module-snapshots.test.mjs tests/bootstrap/packaged-module-sources.test.mjs tests/bootstrap/shared-json-roundtrip.test.mjs tests/bootstrap/native-stdlib-cache-precision.test.mjs tests/bootstrap/shared-test-suite.test.mjs tests/bootstrap/shared-frontend-wasm.test.mjs tests/bootstrap/shared-call-binding-plan.test.mjs
build/native-compiler-docker/bin/vkf-strict -t tests/vkf
node tools/verify-native-wasm-tests.mjs --output=docs/evidence/shared-record-update-native-wasm-2026-09-06.json
node tools/compare-native-wasm-evidence.mjs docs/evidence/shared-named-variadic-native-wasm-2026-09-05.json docs/evidence/shared-record-update-native-wasm-2026-09-06.json docs/evidence/shared-record-update-suite-comparison-2026-09-06.json
node tools/verify-shared-documentation-execution.mjs --output=docs/evidence/shared-documentation-execution-record-update-2026-09-06.json
```

The first focused command exits nonzero for the explicit native tuple RED. The
full suite and documentation smoke also exit nonzero while their failures remain;
the exact 451-case comparison exits zero. The public boundary test uses the
preserved pre-trig snapshot documented in the trig receipt.

Next: the approved C++-private retained compilation form and actual ordered UI
effect consumption. Canonical serialized compile responses must stay byte-for-byte
identical; real operand values feed existing compiler-owned curve/scene packing.
No metadata replay, public execution IR, or JS language-value exposure.
