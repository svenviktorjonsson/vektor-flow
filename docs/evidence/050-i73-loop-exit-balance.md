# 050-I73 loop exit balance evidence

## Scope

- Base: `171c2a75eb81be30f9450967e0f1f23237329560`
- Implementation: `5d0b2dbb0bfc9a226dc5ef87c4e66fd2778c1e8c`
- Branch: `codex/0.5/050-i73-loop-exit-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i73-loop-exit-balance.md`

I71 checks the loop back edge and I72 checks the preheader entry, but the
conditional exit edge could still carry stack values that the linear body
consumed before those checks. I73 requires zero depth immediately after the
fixed loop's conditional jump. It changes no VKF syntax, public API, ABI,
schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i73/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`DAD9FB657C6F294F7410CC83C837C336C40665D5C15FA2F00B26FD88AEFC00D0`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i73/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 9 passed, 0 failed.

The RED leaves one value after the loop condition's conditional jump, then
lets only the linear body consume it. The old tracer therefore reaches zero at
the back edge and final boundary, although the taken exit edge bypasses that
consumption and reaches its block with the hidden value.

Command:

```powershell
node --test --test-name-pattern="exit edge" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `unbalanced fixed-loop exit edge produced output`.
- GREEN: 1 passed, 0 failed after adding `(depth = 0)?!` immediately after
  the fixed-loop conditional jump.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 42 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `17EB6F70609950917F04A461807728F7683E9C0B2E8EFCD011ADBBDA05C79D6B`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `52F9E6A6682175ABCBFAC9F60AEAC7789BD5EDB3A12C58E7A37FBA1AB458040E`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate from linear
terminal balance toward path-aware loop validation. A malformed loop condition
can no longer carry values into its exit block while relying on the untaken
body's linear traversal to hide them. It does not close the full gate.
