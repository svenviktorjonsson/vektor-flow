# Retained UI alias production parity — 2026-09-05

Status: production alias bug fixed; private prerequisites 5/5. No runtime UI
execution/rendering claim. No commit, push or deployment from this packet.

## Observed RED and scope

The exact fixture in `tests/bootstrap/shared-ui-effects.test.mjs` constructs a
Display and Frame, binds 101 x/y samples, then uses `alias: frame` and
`alias.add(...)`. Native and WASM frontends both returned
`{"message":"missing field value in UI handle","ok":false}`.
The strict native driver exited 1 with
`<driver-smoke>:1:1: missing field value in UI handle\n`.

Language guide §1.1 already defines `name: value` as binding that value, without
a retained-handle exception. The implementation incorrectly required a constant
initializer instead of resolving an existing handle load. Integration approved
the narrow production bug fix; no private-probe bypass was implemented.

New production gate: `tests/bootstrap/shared-ui-handle-alias.test.mjs`.
Before the fix: 1/2, exit 1. Valid alias acceptance was RED; exact unresolved,
same-kind shadowing and mismatched shadowing parameter diagnostics were GREEN.

## Implementation

The compiler-private `TypeEnv` binding carries the existing retained identity.
Declaration/update clears stale identity; alias resolution reads the source
identity before rebinding and requires its exact existing handle type. Scope
copies retain binding identity, while new parameters cannot inherit an unrelated
module handle merely because their name matches. The alias IR stays `load`.
The original invalid-handle validation and diagnostic strings remain intact.

Private-only Display/add_frame wrappers retain their original result and
ordered operands. A shared private wrapper builder serves these constructors
and ordinary add. Inferred dimensions propagate from result to wrapper.
Canonical production typed IR contains no effect wrappers or extra fields.
The alias now succeeds in normal canonical production compilation before the
test probe inspects its private execution form.

## Frozen artifacts

| Artifact | SHA-256 |
| --- | --- |
| Production `build/shared-compiler/vkf-compiler.wasm` | `095fefccbc86af69d4f41ab739aeb024d2c5052f9d30ed91115d358dfe1ecd33` |
| Production native frontend probe | `496a93366698072911eef758f8499879f520130fc0841ac459f8ab0be5a87b94` |
| Private `build/shared-ui-probe/vkf-compiler.wasm` | `e8b4dcb3ca24ce0a7953fa2f8d0295daa80adb058b720f8c468ba50a5e64d03d` |
| Private native frontend probe | `60594688a7912b964af05fbdaede99511fccab36b3abf0b0096778b3289b4c2c` |
| Native `build/native-compiler-docker/bin/vkf-strict` | `639ccbc5fd0a2560785c798dc8cd6001b1a13bc6b5b345b26bfb93bca6911ea9` |

## GREEN and regression evidence

Builds use `emscripten/emsdk:4.0.14`, mounted at `/src`:

```text
bash scripts/build-shared-compiler.sh
make -f scripts/shared-ui-probe.mk --jobs=2
apt-get update -qq && apt-get install -y -qq ninja-build && cmake --build build/native-compiler-docker --target vkf-strict -j2
```

All exited 0. Tests run only after their target artifacts finished linking,
using `node:22-bookworm`:

```text
node --test tests/bootstrap/shared-ui-handle-alias.test.mjs tests/bootstrap/shared-ui-frontend.test.mjs
node --test tests/bootstrap/shared-ui-effects.test.mjs
VKF_SHARED_COMPILER_DIR=build/shared-ui-probe node --test tests/bootstrap/shared-ui-frontend.test.mjs
build/native-compiler-docker/bin/vkf-strict -t tests/vkf
```

Results: production alias 2/2 + existing frontend 7/7; private prerequisites
5/5; private frontend 7/7; unchanged native suite **451 passed, 0 failed**.
Every listed gate exited 0. No skips or acceptance changes.

Production focused regression command:

```text
node --test tests/bootstrap/shared-scope-execution.test.mjs tests/bootstrap/shared-call-execution.test.mjs tests/bootstrap/shared-variadic-call-execution.test.mjs tests/bootstrap/shared-record-argument-plan.test.mjs tests/bootstrap/shared-default-call-thunk.test.mjs tests/bootstrap/shared-console-parity.test.mjs tests/bootstrap/shared-list-construction.test.mjs tests/bootstrap/shared-scalar-logic.test.mjs tests/bootstrap/shared-ui-frontend.test.mjs tests/bootstrap/shared-ui-handle-alias.test.mjs
```

**64/64**, exit 0. Root's separately recorded `shared-if-expression.test.mjs`
RED remains outside this focused command and has not been weakened or removed.

One ancillary invocation incorrectly pointed the production-only alias test
at the private probe; its no-`execution_ir` assertion correctly failed. No code
or assertion changed. The production test passes against production, and the
private-compatible seven-case frontend suite was rerun separately as shown.

The original source now reaches native build-only packaging with
`vkf-strict -b build/ui-alias-native-probe.vkf -o build/ui-alias-native-probe`.
That Linux build exits 1 with the existing
`<driver-smoke>:1:1: UI application packaging is unavailable in this build\n`.
This is not claimed as native UI execution or a rendering fix.

## Integration ownership

This follow-up changes `compiler/native/vkf_ast_to_ir_smoke.cpp`, adds
`tests/bootstrap/shared-ui-handle-alias.test.mjs`, and updates the plan and
evidence receipts. The existing private probe header/build seam and browser
adapter macro from the previous packet remain dependencies. No VM/bytecode,
public runner wiring, JavaScript renderer, tuple transport, or unrelated lane
source changed here. `git diff --check` passes.

The remaining UI gates are actual native/WASM effect execution, owned vector
snapshots, exact failing-operand behavior, reset between runs and identical
packed geometry bytes. They are not replaced by these frontend checks.
