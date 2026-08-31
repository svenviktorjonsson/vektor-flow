# 050-I80 loop exit branch-kind evidence

## Scope

- Base: `ea7b19952a2d5619ee0e050159bcd1b11b137b1f`
- Implementation: `af1efc7eeb332f0602fad214d7c02292db41b30c`
- Branch: `codex/0.5/050-i80-loop-exit-branch-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i80-loop-exit-branch-kind.md`

I77 validates the loop-exit target kind, but the edge source identity still
compared only its numeric label field and stack effect. A labeled non-branch
instruction with the same consumption therefore passed as the exit edge. I80
requires the source instruction to be `jump_if_false`. It changes no VKF
syntax, public API, ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i80/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`C0115733F9E23D4FC73B0E3A8FEA9F6A70ED343B09CD4F99C8CAA988FADA4029`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i80/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 13 passed, 0 failed.

The RED replaces `jump_if_false 1` with a `store_local` instruction carrying
label `1`. Both consume one stack value, so the old target equality and every
stack boundary remain satisfied while the malformed CFG produces output.

Command:

```powershell
node --test --test-name-pattern="exit edge is not" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `non-branch fixed-loop exit edge produced output`.
- GREEN: 1 passed, 0 failed after requiring the exit-edge source instruction
  kind to equal `jump_if_false`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 49 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `F03C5F0CA5BC1A58578B0EA390C6C9D6C4844E880628A6C18824CBA3671A4915`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `867FF543A02C63C894F56A96BC80B70913CB39C2A2D113CFD3E702F21503A9B1`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG edge validation. A matching numeric field and
stack effect can no longer mask a non-branch loop exit edge. It does not close
the full gate.
