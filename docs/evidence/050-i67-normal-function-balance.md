# 050-I67 normal function-stack balance evidence

## Scope

- Base: `69220a51b926e3a48c3001af872d25655772da51`
- Implementation: `b1e935164f82bb681cf7382b643dfd612b0279b7`
- Branch: `codex/0.5/050-i67-normal-function-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs`
  - `docs/evidence/050-i67-normal-function-balance.md`

The packet adds the normal numeric function terminal-stack invariant already
enforced by the conditional and loop function validators. It changes no VKF
syntax, public API, ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i67/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`EE9A5FC7E86342E9EAFCD846091970B3C58E46AF0948FC6C7D02AD6180E8750A`.

## TDD evidence

Command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i67/bin').Path
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs
```

- Baseline: 4 passed, 0 failed.
- RED: 4 passed, 1 failed. The malformed normal function left two stack
  values and completed successfully; failure:
  `unbalanced numeric function unexpectedly succeeded`.
- GREEN: 5 passed, 0 failed after adding `(depth = 0)?!` at normal function
  termination.

## Affected verification

The following matrix used the helper-built strict compiler:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i67/bin').Path
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 36 passed, 0 failed. This includes the I66 entry invariant, the new I67
function invariant, and adjacent normal, conditional, and loop validation and
dispatch coverage.

## Contract hashes

- `machine_ir_validation.vkf`:
  `63F08B376458909C3257795F79E1514D5EFE6BD02915E8A146D0D502A7922B87`
- `stage1-machine-ir-stack-validation.test.mjs`:
  `69183C8151F286D489A1D685C178F91A335F0AC48322A85889D2FBC99C4B33D2`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate by making
the original numeric function validator reject residual terminal stack values,
closing the normal-function counterpart to the integrated conditional and loop
checks. It does not by itself close the full gate.
