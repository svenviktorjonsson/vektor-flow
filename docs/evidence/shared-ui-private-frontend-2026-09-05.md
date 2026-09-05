# Private UI frontend prerequisite — 2026-09-05

Historical first-slice receipt. The later [production alias packet](shared-ui-handle-alias-2026-09-05.md)
supersedes the remaining alias RED and artifact hashes below; original evidence
is retained here unchanged.

Status: ordinary add/update/add frontend prerequisite GREEN. Runtime geometry
execution is **not implemented or proved by this packet**. Whole prerequisite
suite remains RED at 4/5 because handle aliases still fail.

## Boundary and checkpoint

Main HEAD: `0e2530cf871ef6c70c650da614e8c66b10a83b95`, with preserved shared
compiler work in the dirty checkout. Nothing staged, committed, pushed or
deployed by this packet. No public syntax, API, schema, ABI or diagnostic change.

The isolated build defines `VKF_PRIVATE_UI_EFFECTS_TEST_PROBE`. Its native and
WASM probes expose `execution_ir` solely for prerequisite inspection. Ordinary
`Frame.add` nodes retain their operation index, authored ordered operands and
original Layer result at their body position. Temporal/indexed add paths and
constructor effects are unchanged. Static registration unwraps only a
compiler-owned private result; it does not replay initialization.

Production `lower_value()` and the production `vkf_compile_source` response
remain unchanged. No private effect appears in canonical serialized `typed_ir`.
Each accepted fixture compares native/WASM production and private canonical
responses, their serialized key order/values, and the complete private form
after removing wrappers. Existing exports are unchanged; WASM imports stay empty.

| Artifact | SHA-256 |
| --- | --- |
| Frozen production `build/shared-compiler/vkf-compiler.wasm` | `2e302b672863df593d75367aeaa43ed12809db656029b074acfc618c9827edc2` |
| Private `build/shared-ui-probe/vkf-compiler.wasm` | `1f17894813cd4d39c2146262452d9f1e0e8e011e42aeb2c85b6bdab49b396ae2` |
| Private `build/shared-ui-probe/vkf-compiler-probe` | `76262e47399edf29fc699f1c7472fb1d7394e8a66c1af94ef14e8fd2c4c0b056` |

## RED → GREEN

All commands run from the repository mounted at `/src`; Node is
`node:22-bookworm`, compiler build is `emscripten/emsdk:4.0.14`.

Build: `make -f scripts/shared-ui-probe.mk --jobs=2`.
It writes only `build/shared-ui-probe` and reuses the generated packaged stdlib
header from the ordinary shared build. The final native/WASM build exited 0.

Gate: `node --test tests/bootstrap/shared-ui-effects.test.mjs`.

- RED before implementation: 0/5, exit 1. The first four accepted programs had
  zero body effect sites; invariance assertions passed. Alias compilation failed
  with the existing `missing field value in UI handle` diagnostic.
- Final run: 4/5, exit 1; no skips or relaxed assertions. Ordinary add/update/add
  placement, named operand order, failed-first-operand structure and conditional
  placement are GREEN. These last three follow directly from retaining the
  ordinary call site; none is a runtime execution claim.
- Alias remains RED with exactly `missing field value in UI handle`.

## Regression

Fresh private artifact:

```text
VKF_SHARED_COMPILER_DIR=build/shared-ui-probe node --test tests/bootstrap/shared-ui-frontend.test.mjs
```

7/7, exit 0: README edits, automatic dimensions, approved index axes, complex
positions, source-order diagnostics and recovery. Final rebuild has identical
artifact hashes to this tested build.

Frozen production artifacts:

```text
node --test tests/bootstrap/shared-scope-execution.test.mjs tests/bootstrap/shared-call-execution.test.mjs tests/bootstrap/shared-variadic-call-execution.test.mjs tests/bootstrap/shared-record-argument-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-console-parity.test.mjs tests/bootstrap/shared-list-construction.test.mjs tests/bootstrap/shared-scalar-logic.test.mjs tests/bootstrap/shared-if-expression.test.mjs tests/bootstrap/shared-ui-frontend.test.mjs
```

63/64, exit 1. Calls, all 14 unchanged canonical block cases, record adaptation,
variadic/fixed spreads, console records, numeric lists, scalar logic and geometry
frontend regressions pass. The separate root-owned conditional effect fixture
fails with `unsupported expression kind if_expr in function $vkf_main.body.body[2].expr.args[0]`.
Reported to integration; not changed by this packet. Production artifact hash
is unchanged. No fresh native 451-suite completion is claimed here.

`git diff --check` passes (existing CRLF conversion notices only).

## Still required

- Private constructor/alias effects without changing canonical public IR.
- Native and WASM execution consumers, immutable before/after vector snapshots,
  exact error/output order, reset between runs and equal packed geometry bytes.
- README browser execution/rendering verification and integration review.

The source-structure tests are prerequisites, not substitutes for any of these
acceptance gates. No tuple representation work is included.
