# Output-only browser boundary — 2026-09-05

Status: accepted A-boundary implemented in the **unpublished shared adapter**.
No published runner wiring, native math change, tuple implementation, UI packet
schema, commit, push or deployment is included.

Viktor's decision is recorded in `docs/plans/browser-tuple-transport-decision.md`,
`CONTEXT.md` and ADR 0004. It supersedes the earlier unapproved choice labels:
all VKF values stay inside WASM; JavaScript receives compiler-formatted console
output and versioned graphics/UI packets, not arbitrary values or value handles.

## Implementation and RED → GREEN

`web/playground/vkf-shared-compiler.mjs` now invokes the emitted zero-argument
entry directly. It no longer imports the JavaScript tagged-value decoder,
materializes returned values, retains a host value handle, or returns `values`.
Its run result is `{kind, stdout, stderr}`. Opaque addresses/bytes move from the
program WASM memory to the compiler WASM formatter without interpretation.
Actual program invocation, no-host-import validation and exact stdout remain.

`tests/bootstrap/shared-host-output-boundary.test.mjs` initially failed 0/2:
the old adapter returned `values`, and instrumentation caught JavaScript reading
tagged values. The final gate is **3/3**: output-only result shape for scalars,
vectors and records; no JavaScript tag decoding; unsupported tuples fail in
compiler lowering and cannot escape as a host value. Tuple execution is still
unsupported and is not claimed by that guard.

The same-suite verifier no longer treats empty `values` as empty stdout. It
rejects leaked values even when a stdout string is also present. Its RED was
captured before implementation; the final outcome gate passes.

## Preserved numeric and behavioral assertions

The shared adapter tests no longer inspect arbitrary JavaScript `values`.
`shared-native-output.mjs` compiles fresh native executables and compares exact
stdout/stderr. Original sources remain exercised. Numeric predicates that need
more precision than displayed text execute as VKF assertions instead:

- all 101 range samples retain exact scalar comparisons for both edits;
- all 101 sine samples retain **absolute error <= 1e-12**;
- all six lifted atan2 values retain **absolute error < 1e-6** and both-element
  shape checks;
- sample variance retains the original exact `32/7` value assertion;
- original test discovery/assertion, error, vector, record and source-order
  checks remain active.

Generated VKF uses decimal literals `0.000000000001` and `0.000001`, not
unsupported scientific-notation source. Thresholds are unchanged. References
are test inputs, never a JavaScript execution or rendering fallback.

## Frozen compiler evidence

No compiler source or artifact changed during this A-boundary packet.

- Shared WASM SHA-256:
  `095fefccbc86af69d4f41ab739aeb024d2c5052f9d30ed91115d358dfe1ecd33`.
- Native SHA-256:
  `639ccbc5fd0a2560785c798dc8cd6001b1a13bc6b5b345b26bfb93bca6911ea9`.
- The preceding alias receipt proves native **451/451** for that exact native
  binary; this packet adds fresh native compilation per output-parity case.

Node 22 Linux container, repository mounted at `/src`:

```text
node --test tests/bootstrap/shared-host-output-boundary.test.mjs tests/bootstrap/native-wasm-gate-outcomes.test.mjs tests/bootstrap/shared-math-builtins.test.mjs tests/bootstrap/shared-native-test-gate.test.mjs tests/bootstrap/shared-stdlib-execution.test.mjs tests/bootstrap/shared-vector-lifting.test.mjs tests/bootstrap/shared-vector-arithmetic.test.mjs tests/bootstrap/shared-source-math-lifting.test.mjs tests/bootstrap/shared-stat-execution.test.mjs tests/bootstrap/shared-scope-execution.test.mjs tests/bootstrap/shared-call-execution.test.mjs tests/bootstrap/shared-variadic-call-execution.test.mjs tests/bootstrap/shared-record-argument-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-console-parity.test.mjs tests/bootstrap/shared-list-construction.test.mjs tests/bootstrap/shared-scalar-logic.test.mjs tests/bootstrap/shared-ui-frontend.test.mjs tests/bootstrap/shared-ui-handle-alias.test.mjs tests/bootstrap/shared-ui-effects.test.mjs
```

**90/91**, exit 1, zero skips. The sole failure remains the existing canonical
`core/22-variadics-spreads.vkf` named-rest blocker:
`WASM call binding does not yet support variadic parameters for capture_named`.
That source fails before output extraction; it is not hidden or reclassified.

The same command without `shared-stat-execution.test.mjs`, using
`--test-reporter=dot`, passes **86/86**, exit 0. This is the clean focused
boundary gate, not a claim that the excluded five-case stat suite is all GREEN.
The stat suite separately passes 4/5. Root's independent conditional-expression
RED is also outside this packet's claim.

## Separate exact sine-output RED

`node --test tests/bootstrap/shared-sine-output-determinism.test.mjs` remains
**0/1**, exit 1. Exact console bytes differ at three of 101 samples even though
the original 1e-12 assertions pass in native and WASM:

| Sample index | Native stdout token | WASM stdout token |
| --- | --- | --- |
| 25 | `0.598472144103957` | `0.598472144103956` |
| 62 | `-0.0830894028174964` | `-0.0830894028174963` |
| 84 | `0.85459890808828` | `0.854598908088281` |

The exact comparison is kept in its own unskipped test, not rounded, normalized
or replaced by a tolerance. Native system sine and the bundled emitted WASM
sine use different implementations. A separate decision audit will measure the
accuracy/compatibility implications before any native math replacement.

## Touched scope

Adapter and verifier; accepted decision/context/ADR; output boundary and oracle
tests; migrated shared math, discovery, stdlib, vector and stat tests; separate
sine determinism RED. Legacy published `vkf-browser-compiler.mjs`, its value
API tests, production UI renderer and all compiler runtime sources are untouched.
`git diff --check` passes. No performance claim is made.
