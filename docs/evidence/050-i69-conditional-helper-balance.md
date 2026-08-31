# 050-I69 conditional helper-stack balance evidence

## Scope

- Base: `b600a7be21d4902a0dde3dcc497052b137d5803e`
- Implementation: `5046218f3e9a0ba9410b37e7b765779efeac8480`
- Branch: `codex/0.5/050-i69-conditional-helper-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs`
  - `docs/evidence/050-i69-conditional-helper-balance.md`

The packet adds terminal-stack validation for the linked CPU-count helper
inside the conditional numeric module. It changes no VKF syntax, public API,
ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i69/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`82AA5311D07DAB7731164028EFD96F7364E42A619B04C26395E2B98EFF5CF77B`.

## Windows test-work path

The long packet path made one existing test's manifest path exactly 260
characters, which caused the Windows file write to fail before validation.
All verification therefore used the same in-repository worktree through its
8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
```

No test data was written outside the packet worktree.

## TDD evidence

Command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i69/bin').Path
node --test tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs
```

- Baseline: 6 passed, 0 failed.
- RED: 6 passed, 1 failed. The malformed linked helper left two stack values
  and completed successfully; failure:
  `unbalanced fixed-conditional helper produced output`.
- GREEN: 7 passed, 0 failed after adding `(depth = 0)?!` at linked-helper
  termination.

## Affected verification

The following matrix used the helper-built strict compiler and short in-repo
test-work path:

```powershell
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 38 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `C15945D2FC942223E8F2E571ECE289DC10DB65B3186C509AB81D7D1A2B968160`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `84F657A51B5D65ACDC61A1BA7ED8CFD4D55AFE10C5FB59A09C8D30030979C1A8`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate by ensuring
every function in both the normal and conditional numeric modules has a
balanced terminal stack. It closes the linked-helper symmetry gap identified
by I68 but does not by itself close the full gate.
