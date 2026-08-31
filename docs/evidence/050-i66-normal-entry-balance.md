# 050-I66 normal entry-stack balance evidence

## Scope

- Base: `29ac729a3b7d957987dc38546b0cc76fff43ef4f`
- Implementation: `8463a745d0878511f93f9b15575efd13246802fa`
- Branch: `codex/0.5/050-i66-normal-entry-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs`
  - `docs/evidence/050-i66-normal-entry-balance.md`

The packet adds the normal numeric entry-stack terminal invariant already
enforced by the conditional and loop validators. It changes no VKF syntax,
public API, ABI, schema, diagnostic text, or generated program output.

## TDD evidence

The focused RED and GREEN runs used the compatible I54 strict compiler at
SHA-256
`C0996D0468C44CF020930E78517CAC497939ED360A0A048269247C2E4A71E2D9`.

Command:

```powershell
$env:VKF_NATIVE_BIN='.worktrees\0.5\050-i54-generated-artifact-auto-cpu\build\i54\bin\Release'
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs
```

- RED: 3 passed, 1 failed. The new malformed entry completed successfully;
  failure: `unbalanced numeric entry unexpectedly succeeded`.
- GREEN: 4 passed, 0 failed after adding `(depth = 0)?!` at normal entry
  termination.

## Affected verification

A strict compiler was built from the packet base in the isolated worktree,
including `vkf_csv_demand_source_scanner.cpp`. Compiler SHA-256:
`CC4A4E74FAE180E619730FB5889AE4186F1631547220CD2E9DC8A72582739A0C`.

Command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path 'build\050-i66-current\bin').Path
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 35 passed, 0 failed.

The repository helper `scripts/build-native-compiler.ps1` could not build the
current strict compiler because its source list omits the CSV demand scanner;
the packet did not widen scope to change that helper. The affected suite was
therefore rerun with an equivalent direct Clang build including that source.
No full-suite run was required for this bounded validator change.

## Contract hashes

- `machine_ir_validation.vkf`:
  `8B353D7C23AA92A27B4F64A738B0696C9D85CDB176C5019BBCD664695485AF61`
- `stage1-machine-ir-stack-validation.test.mjs`:
  `43A02577FBC318F22E94622C2C4477EA8F9834E1FB713A2CB19B76835858B83E`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate by making
the original numeric entry validator reject residual terminal stack values,
closing the normal-entry counterpart to the already integrated conditional
and loop checks. It does not by itself close the full gate.
