# 050-I77 loop exit target-kind evidence

## Scope

- Base: `241ac887e9ceeb6d42820217c396eec71115d10b`
- Implementation: `23987235db252cc3323290fa7d323c89c804fa08`
- Branch: `codex/0.5/050-i77-loop-exit-target-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i77-loop-exit-target-kind.md`

I73 establishes exit-edge stack balance, but exit target identity still
compared only numeric label fields. A stack-neutral non-label instruction
carrying the same field therefore passed as the loop exit. I77 requires the
exit instruction to be a label before comparing identities. It changes no VKF
syntax, public API, ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i77/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`9EE717356D4A824E26DD5CFA089C7663E059418ECA75DB91B2D7040BF5592F7D`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i77/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 11 passed, 0 failed.

The RED replaces only the loop exit's stack-neutral `label 1` with a
stack-neutral `jump 1`. The old target equality and every stack boundary remain
satisfied, so the malformed CFG produces output.

Command:

```powershell
node --test --test-name-pattern="exit edge targets" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `non-label fixed-loop exit target produced output`.
- GREEN: 1 passed, 0 failed after requiring the loop exit instruction kind to
  equal `label`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 46 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `1D2B8CF78F137B09EC506804E94ABD2026A6B4E9E87B0E59E1A27C812A7A1648`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `1330BC96F93065CCE74F3C2738B4217EC1C2D18C91E0E698CFE4F7D845EEBA65`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG target validation. A matching numeric field can no
longer mask a non-label loop-exit target. It does not close the full gate.
