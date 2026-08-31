# 050-I76 loop header target-kind evidence

## Scope

- Base: `ff54703244e7ec6b051fbd0185cafe84ea6e3c92`
- Implementation: `e84bd136dc548209ae24419a9455869e968cd767`
- Branch: `codex/0.5/050-i76-loop-header-target-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i76-loop-header-target-kind.md`

I71 and I72 establish back-edge/header stack agreement, but target identity
still compared only numeric label fields. A stack-neutral non-label instruction
carrying the same field therefore passed as the loop header. I76 requires the
header instruction to be a label before comparing identities. It changes no
VKF syntax, public API, ABI, schema, diagnostic text, or generated program
output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i76/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`6C4ABF5179A55B7F57FDD70FAC1AAA5D2E4DB2CFDF600E5114CCDECE72954F23`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i76/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 10 passed, 0 failed.

The RED replaces only the loop header's stack-neutral `label 0` with a
stack-neutral `jump 0`. The old target equality and every stack boundary remain
satisfied, so the malformed CFG produces output.

Command:

```powershell
node --test --test-name-pattern="non-label header" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `non-label fixed-loop header target produced output`.
- GREEN: 1 passed, 0 failed after requiring the loop header instruction kind
  to equal `label`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 45 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `EFCA46A2D67386E1271A5233EBCEAC63B6BDF05A60D7DAFCCAA870F4AE8E8E86`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `F26EA827985C938A79A3C7CB0BAA46ABF86116EBC478467F95D8844DE4635365`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG target validation. A matching numeric field can no
longer mask a non-label loop-header target. It does not close the full gate.
