# 050-I78 conditional branch-kind evidence

## Scope

- Base: `6ff6bdd324e8dd8540397dbb65948a2008ba0bfb`
- Implementation: `ad2db00363a8b446e494454dc0df505a4be3c51e`
- Branch: `codex/0.5/050-i78-conditional-branch-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs`
  - `docs/evidence/050-i78-conditional-branch-kind.md`

I75 validates the false target kind, but the source identity still compared
only its numeric label field and stack effect. A labeled non-branch instruction
with the same consumption therefore passed as the false edge. I78 requires the
source instruction to be `jump_if_false`. It changes no VKF syntax, public API,
ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i78/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`238FE3521027F24A808E36E0E80E1860D9D07447E60563696C4E1B5EB44960A7`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i78/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

Result: 10 passed, 0 failed.

The RED replaces `jump_if_false 1` with a `store_local` instruction carrying
label `1`. Both consume one stack value, so the old target equality and every
stack boundary remain satisfied while the malformed CFG produces output.

Command:

```powershell
node --test --test-name-pattern="not a conditional branch" tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `non-branch fixed-conditional false edge produced output`.
- GREEN: 1 passed, 0 failed after requiring the edge source instruction kind
  to equal `jump_if_false`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 47 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `758AEB9102D09E192A5E4896F4DBD50EBBD9463E1A306FA872CC00873CB49FBC`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `E135794F698532D348C09E499F2AF83C15F6F696BB5E9B3E66917E434ADE7A7C`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG edge validation. A matching numeric field and
stack effect can no longer mask a non-branch conditional edge source. It does
not close the full gate.
