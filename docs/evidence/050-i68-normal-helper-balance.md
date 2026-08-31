# 050-I68 normal helper-stack balance evidence

## Scope

- Base: `f60cc1d62e614a6deb5deb70c0dcb184185efe02`
- Implementation: `9f5c3d7c97186fbdc57c9af49a9272ab4729c17a`
- Branch: `codex/0.5/050-i68-normal-helper-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs`
  - `docs/evidence/050-i68-normal-helper-balance.md`

The packet adds terminal-stack validation for the generated CPU-count helper
inside the normal numeric module. It changes no VKF syntax, public API, ABI,
schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i68/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`3248D008734A131E125253C849C7C1B49557002C1CA0AFEAB69C980A3E9D5CD0`.

## TDD evidence

Command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i68/bin').Path
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs
```

- Baseline: 5 passed, 0 failed.
- RED: 5 passed, 1 failed. The malformed normal helper left two stack values
  and completed successfully; failure:
  `unbalanced numeric helper unexpectedly succeeded`.
- GREEN: 6 passed, 0 failed after adding `(depth = 0)?!` at helper-function
  termination.

## Affected verification

The following matrix used the helper-built strict compiler:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i68/bin').Path
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 37 passed, 0 failed. This includes I66 entry balance, I67 main-function
balance, the new I68 helper balance, and adjacent normal, conditional, and loop
validation and dispatch coverage.

## Contract hashes

- `machine_ir_validation.vkf`:
  `34437E89DCFEB360AE9A35C75B3B6388031A8C2F500E25BA1D0D20048A897CCB`
- `stage1-machine-ir-stack-validation.test.mjs`:
  `3B5D7038DFD47A00EB920DCA11DF94FF359C0D12B280F4D71A343FD1AC6D19A4`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate by ensuring
every function in the normal numeric module has a balanced terminal stack.
The analogous linked helper in the conditional module remains a separate
structural-validation slice. This packet does not close the full gate.
