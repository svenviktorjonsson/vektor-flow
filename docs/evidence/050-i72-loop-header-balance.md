# 050-I72 loop header balance evidence

## Scope

- Base: `b52919b6256a368ea09d4145f512213cc7eba6e5`
- Implementation: `02e65bb212591b034f37c0adfd0352cfdfacd490`
- Branch: `codex/0.5/050-i72-loop-header-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i72-loop-header-balance.md`

I71 makes the loop exit path independent: the back-edge boundary must be zero,
the exit label is stack-neutral, and the existing final check validates the
exit block from zero. I72 therefore closes the next path-aware omission by
requiring the preheader to enter the fixed-loop header at zero depth. It
changes no VKF syntax, public API, ABI, schema, diagnostic text, or generated
program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i72/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`0D8CCE9659C67598151E0C4C5C4716F7BC24B89BF454076E0C4F46A34A48871C`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i72/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 8 passed, 0 failed.

The RED leaves two values in the preheader and consumes those two values only
on the first linear traversal of the loop body. The old tracer therefore still
reaches zero at both the back edge and final function boundary, although later
iterations enter the header at a different depth.

Command:

```powershell
node --test --test-name-pattern="preheader" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `mismatched fixed-loop header entry produced output`.
- GREEN: 1 passed, 0 failed after adding `(depth = 0)?!` immediately before
  the fixed-loop header label.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 41 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `FFB7973454193DFFC355E7562151D57510B9DB3FFC03551A5B3153BD660CE4FD`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `300127D9CD170C485F26AA3CB1EEACDFC1F919E720D6C3CBDBD9017C470FEB53`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate from linear
terminal balance toward path-aware loop validation. A malformed preheader can
no longer disagree with the loop back edge while using the first linear body
traversal to mask that mismatch. It does not close the full gate.
