# Shared named-variadic call checkpoint

Based on main `eeb71263`. This bounded packet uses the existing native captured
record layout and field order in emitted WASM. It adds no public syntax, schema,
diagnostic, opcode, host capability, or JavaScript value interpretation.

## RED → GREEN

- The unchanged variadics guide and all 14 `tests/vkf/calls.vkf` cases initially
  stopped at unsupported named capture. All now match fresh native execution.
  Guide stdout is exactly `10\n7\n(flag:true, mode:fast)\n`.
- An omitted fixed default initially lost captured fields in the private thunk
  (`missing captured named argument flag for capture`). The factory-owned final
  call now forwards the already evaluated record by exact private call identity.
  It does not replay expressions or change the canonical frontend response.
- A captured fixed numeric vector initially aliased its caller: editing the
  original made the captured `[1, 2]` print `[9, 2]`. Existing WASM instructions
  now copy fixed numeric components once, including nested numeric vectors.
- Omitted/provided defaults, skipped failing defaults, owned text, repeated-run
  reset, native field/effect order, and exact first missing/duplicate diagnostics
  are covered. This is not a general aggregate ownership completion claim.

## Verified gates

| Gate | Result |
| --- | --- |
| Named capture and unchanged canonical calls | 21/21 |
| Existing output/scope/call/spread/tuple/list/vector/logic regressions | 69/69 |
| Frontend/module/cache/JSON/test selection and call-plan contracts | 22/22 |
| Fresh unchanged native suite | 451 passed, 0 failed |
| Full unchanged native/WASM suite | 133/451; 318 failures; zero discovery errors |
| Documentation execution smoke | 46/87 unique programs; 41 failures |

No skips or weakened gates. Full-suite comparison against the committed trig
receipt has exactly 44 changed fields: WASM result, pass status and reason for
each of the 14 call cases, plus the two summary totals. Every source hash,
native result, remaining 437 WASM result objects and exact diagnostic matches.
See `shared-named-variadic-suite-comparison-2026-09-06.json` (its `exact:false`
records those expected improvements, not an unrelated regression).

The documentation gain is only the unchanged variadics guide. Successful return
does not verify every stdout, graphic, edit/reset behavior or native parity.
First UI execution remains blocked at `Display<2>`; the previously missing
spectral header remains a separate expanded-evaluator build blocker. No site
deployment or runtime UI completion is claimed here.

## Artifact identity

- Shared compiler WASM: `a27c1f06227c31d269b2f868e415365647415f5753f80116c9b9382881c78878`
- Fresh strict native compiler: `4728738922848fc7e5a94fc90e7492ce6648dcd5e460834bba75d140be68c360`

The full gate completed before the usage reset; its complete 451-entry receipt
and artifact hash were revalidated afterwards. No incomplete run is reported as
completed. Raw run filenames retain their September 5 start date.

## Reproduce

Inside `vkf-trig-toolchain:14`, repository mounted at `/src`:

```sh
make --file=scripts/shared-compiler.mk --jobs=2
node --test tests/bootstrap/shared-named-variadic-execution.test.mjs tests/bootstrap/shared-tuple-execution.test.mjs tests/bootstrap/private-tuple-bytecode.test.mjs tests/bootstrap/shared-host-output-boundary.test.mjs tests/bootstrap/shared-console-parity.test.mjs tests/bootstrap/shared-stdout-formatter.test.mjs tests/bootstrap/shared-scope-execution.test.mjs tests/bootstrap/shared-call-execution.test.mjs tests/bootstrap/shared-variadic-call-execution.test.mjs tests/bootstrap/shared-record-argument-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-vector-arithmetic.test.mjs tests/bootstrap/shared-list-construction.test.mjs tests/bootstrap/shared-scalar-logic.test.mjs
node --test tests/bootstrap/shared-module-linker.test.mjs tests/bootstrap/shared-module-snapshots.test.mjs tests/bootstrap/packaged-module-sources.test.mjs tests/bootstrap/shared-json-roundtrip.test.mjs tests/bootstrap/native-stdlib-cache-precision.test.mjs tests/bootstrap/shared-test-suite.test.mjs tests/bootstrap/shared-frontend-wasm.test.mjs tests/bootstrap/shared-call-binding-plan.test.mjs
build/native-compiler-docker/bin/vkf-strict -t tests/vkf
node tools/verify-native-wasm-tests.mjs --output=docs/evidence/shared-named-variadic-native-wasm-2026-09-05.json
node tools/compare-native-wasm-evidence.mjs docs/evidence/shared-trig-production-full-suite-2026-09-05.json docs/evidence/shared-named-variadic-native-wasm-2026-09-05.json docs/evidence/shared-named-variadic-suite-comparison-2026-09-06.json
node tools/verify-shared-documentation-execution.mjs --output=docs/evidence/shared-documentation-execution-named-2026-09-05.json
```

The full gate and documentation smoke deliberately exit nonzero while failures
remain. The exact comparer also exits nonzero for the 14 documented improvements.

## Separate preserved REDs

`shared-named-record-followups.test.mjs` remains **0/2**, unskipped, and is not
included in the GREEN totals above:

1. Native named capture prints a tuple field as `(pair:[1, 2])`; emitted WASM
   retains `(pair:(1, 2))`. Do not make a tuple an array to force equality. The
   native capture display inference needs its own correction and authority audit.
2. Native `record.points:[8,4]` replaces that field. Emitted WASM currently
   appends another `points` field, retaining the old one. The private emitted
   record-set implementation is a bounded next prerequisite.

The attempted chained `record.points.0:8` tracer is itself rejected natively
with `unsupported dotted_index bind base`; it is not invented valid syntax.
The earlier effectful positional-variadic native crash is also unresolved and
separate. After the bounded record replacement prerequisite, return to the first
editable UI example and real compiler-owned execution-site effects.
