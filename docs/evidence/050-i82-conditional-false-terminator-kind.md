# 050-I82 conditional false-arm terminator evidence

## Scope

- Base: `a929f471e47b70c256634ceeaf610084ecda3df2`
- Implementation: `1ab9b3368015b49c7617623eec8e39a7958e1bb8`
- Branch: `codex/0.5/050-i82-conditional-false-terminator-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs`
  - `docs/evidence/050-i82-conditional-false-terminator-kind.md`

The existing final balance check establishes false-arm stack balance, but a
stack-equivalent non-terminator could still satisfy that boundary. I82 requires
the false arm to end in `return_f64`. It changes no VKF syntax, public API, ABI,
schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i82/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`04B2EBDE8A7651C0CE607EDEA48BA65A57578982E2E9D2312755AF701725754A`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i82/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

Result: 12 passed, 0 failed.

The RED replaces the false arm's `return_f64` with `store_local`. Both consume
one stack value, so the final stack boundary remains zero while the malformed
non-terminating CFG produces output.

Command:

```powershell
node --test --test-name-pattern="false arm is not" tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `unterminated fixed-conditional false arm produced output`.
- GREEN: 1 passed, 0 failed after requiring the false-arm terminator kind to
  equal `return_f64`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 51 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `82FE7D837E45E1123B897D5C7B3F02DD0AD32B9CC7FE33013EDBE4AF4F980ED9`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `9A056A4C4022882E7232C1A4C1301334269BC0789E8F4C7184CD904ADC82C8B4`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG terminator validation. Stack equivalence can no
longer mask a missing return from the conditional false arm. It does not close
the full gate.
