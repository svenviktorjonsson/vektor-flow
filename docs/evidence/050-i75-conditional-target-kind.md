# 050-I75 conditional target-kind evidence

## Scope

- Base: `a4b7553ca196fc3a9c7655fd79a0a65318366214`
- Implementation: `1b8b32d4289c4bbc8e8d0555be6dfb586a1f5d02`
- Branch: `codex/0.5/050-i75-conditional-target-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs`
  - `docs/evidence/050-i75-conditional-target-kind.md`

I74 closes the fixed conditional's false-edge stack balance, but target
identity still compared only numeric label fields. A stack-neutral non-label
instruction carrying the same field therefore passed as the false target. I75
requires the target instruction to be a label before comparing identities. It
changes no VKF syntax, public API, ABI, schema, diagnostic text, or generated
program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i75/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`BD342948C866D881269874A5846ECECE4F290A5BF2C7DF69F757BE3C96A145F9`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i75/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

Result: 9 passed, 0 failed.

The RED replaces only the false target's stack-neutral `label 1` with a
stack-neutral `jump 1`. The old target equality and every stack boundary remain
satisfied, so the malformed CFG produces output.

Command:

```powershell
node --test --test-name-pattern="not a label" tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `non-label fixed-conditional target produced output`.
- GREEN: 1 passed, 0 failed after requiring the false target instruction kind
  to equal `label`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 44 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `D9282EC701761FB207A55EB66256D1423C1DB16264BFF8E851DEFB34F20DF0E4`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `189F5CD304F1D75254F2C2618C3B3C6237C3997D4D945E97E6F0A8862322DC1A`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate from stack
predecessor agreement toward structurally sound fixed-CFG target validation. A
matching numeric field can no longer mask a non-label conditional target. It
does not close the full gate.
