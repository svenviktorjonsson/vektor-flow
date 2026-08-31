# 050-I81 conditional then-arm terminator evidence

## Scope

- Base: `f3ec9ce3b6bc5c60c86f32060af195bd60906e00`
- Implementation: `9375f4ab918a811785af8b1e3eff77215fffc822`
- Branch: `codex/0.5/050-i81-conditional-then-terminator-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs`
  - `docs/evidence/050-i81-conditional-then-terminator-kind.md`

I70 establishes then-arm stack balance, but a stack-equivalent non-terminator
could still satisfy that boundary and fall through into the false block. I81
requires the then arm to end in `return_f64`. It changes no VKF syntax, public
API, ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i81/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`CA62A4C9DC8104AE84B5E1D53388C49CC8A188A113EADA840369FF04682E75B2`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i81/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

Result: 11 passed, 0 failed.

The RED replaces the then arm's `return_f64` with `store_local`. Both consume
one stack value, so the then-arm and final stack boundaries remain zero while
the malformed fallthrough CFG produces output.

Command:

```powershell
node --test --test-name-pattern="then arm is not" tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `unterminated fixed-conditional then arm produced output`.
- GREEN: 1 passed, 0 failed after requiring the then-arm terminator kind to
  equal `return_f64`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 50 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `D2504D26CED79DE9835D75D3BDE7A191871D5B5026FF4D39F1512DB52BA39B28`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `4C82FE785EBD6599E774ED1301ECABA54B30F32A1818B9AE0D2766C38AF5A4C9`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG terminator validation. Stack equivalence can no
longer mask fallthrough from the conditional then arm. It does not close the
full gate.
