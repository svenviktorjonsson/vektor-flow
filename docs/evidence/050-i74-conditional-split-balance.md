# 050-I74 conditional split balance evidence

## Scope

- Base: `a22f5a01e896930837ba0bd5a2b46b9e8c420a37`
- Implementation: `3e39f530480f2a2fdba1748ef6072f2e4391120f`
- Branch: `codex/0.5/050-i74-conditional-split-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs`
  - `docs/evidence/050-i74-conditional-split-balance.md`

I70 checks the fixed conditional's then-arm terminal and the existing final
check covers its false-arm terminal, but the false edge could still carry stack
values that the linear then arm consumed first. I74 requires zero depth
immediately after the conditional jump. It changes no VKF syntax, public API,
ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i74/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`4049C0F2EF44F773821C4D97FBD8A07E63F333CB439EEC7286ADEC0D48BEC71B`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i74/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

Result: 8 passed, 0 failed.

The RED leaves one value after the fixed conditional's false jump, then lets
only the linear then arm consume it. The old tracer therefore reaches zero at
the then-arm and final boundaries, although the taken false edge bypasses that
consumption and reaches its block with the hidden value.

Command:

```powershell
node --test --test-name-pattern="false edge" tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `unbalanced fixed-conditional false edge produced output`.
- GREEN: 1 passed, 0 failed after adding `(depth = 0)?!` immediately after
  the fixed conditional's false jump.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 43 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `339F40E9E07B8D4E1294CF11FF3E9355E73FA663AB11E6521858B7F6E8967FBB`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `9F78ED6E2285AC67B888DC54ED935B595C06E386CFB822B0489D55485BF917CB`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate from linear
terminal balance toward path-aware conditional validation. A malformed
condition can no longer carry values into its false block while relying on the
untaken then arm's linear traversal to hide them. It does not close the full
gate.
