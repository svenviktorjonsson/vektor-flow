# 050-I70 conditional then-arm balance evidence

## Scope

- Base: `4ac4fe1d1155b1d979d106fe07060986d4f92d56`
- Implementation: `d7600e793d344f079bbb82f0352263836427c1a8`
- Branch: `codex/0.5/050-i70-conditional-then-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs`
  - `docs/evidence/050-i70-conditional-then-balance.md`

The packet adds a terminal-stack check at the fixed conditional's then-arm
return boundary. It changes no VKF syntax, public API, ABI, schema, diagnostic
text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i70/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`F4A3EC31A5A05D9F0780C64528F39D87203E5D6DDBAAB518F899D94902D6F4F4`.

## Test-work isolation

Verification used the same packet worktree through its 8.3 short path to stay
below the Windows 260-character path boundary:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i70/bin').Path
```

The inherited I69 receipt records a 7/7 conditional baseline. One initial I70
baseline rerun hit an unrelated fixed 2-second malformed-artifact process
timeout under concurrent system load; the serial affected matrix below passed
that existing case. No test data was written outside the packet worktree.

## TDD evidence

The RED mutates both arms so the then arm leaves two values and the false arm
consumes one. The old linear tracer still ends at depth zero, isolating the
missing per-path boundary rather than duplicating whole-function validation.

Command:

```powershell
node --test --test-name-pattern="then arm" tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `unbalanced fixed-conditional then arm produced output`.
- GREEN: 1 passed, 0 failed after adding `(depth = 0)?!` immediately after the
  then-arm return instruction.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 39 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `49E475C1E75E7430DB12CAA723379F1BD899DC1EC946AA66592D4E9180169BAC`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `39EB643F8997A5BE177CF1405D9C724358587C215511340F4A2B9DF2AE2BDA24`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate from linear
terminal balance toward path-aware control-flow validation. A malformed then
arm can no longer borrow stack consumption from the false arm to make the
whole linear trace appear balanced. It does not by itself close the full gate.
