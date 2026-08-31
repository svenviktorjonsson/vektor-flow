# 050-I79 loop back-edge kind evidence

## Scope

- Base: `3a5684b1ad62f0d691862c5cdde326d98fc1fd7c`
- Implementation: `29b74212b2a416cf635d973a2296ca98b2bb17ca`
- Branch: `codex/0.5/050-i79-loop-backedge-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i79-loop-backedge-kind.md`

I76 validates the loop-header target kind, but the back-edge source identity
still compared only its numeric label field and stack effect. A labeled
stack-neutral non-jump therefore passed as the back edge. I79 requires the
source instruction to be `jump`. It changes no VKF syntax, public API, ABI,
schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i79/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`FCBEA15253A7CA7390DF8FFE8A0605DA35988ED60A2CBC1FCBB23392E59DF4F1`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i79/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 12 passed, 0 failed.

The RED replaces only the stack-neutral back-edge `jump 0` with stack-neutral
`label 0`. The old target equality and every stack boundary remain satisfied,
so the malformed CFG produces output.

Command:

```powershell
node --test --test-name-pattern="back edge is not" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `non-jump fixed-loop back edge produced output`.
- GREEN: 1 passed, 0 failed after requiring the back-edge source instruction
  kind to equal `jump`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 48 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `027DEEE91443BAC0C0561CF552E2C5B65BCAD03CB70EBC85A3468E9B6B2853D6`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `2F4C10D4D955AE14DE1EAA5C1F5B6221AFBC6905DFD5EE04A215428A546C71CC`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG edge validation. A matching numeric field and
stack effect can no longer mask a non-jump loop back edge. It does not close
the full gate.
