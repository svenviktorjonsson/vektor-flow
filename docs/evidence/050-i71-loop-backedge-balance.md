# 050-I71 loop back-edge balance evidence

## Scope

- Base: `0da326d1134c837f46f01fbd19a060af99970aa4`
- Implementation: `3e743bba7d67456c750d153fdc1a9d0a9bf75382`
- Branch: `codex/0.5/050-i71-loop-backedge-balance`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i71-loop-backedge-balance.md`

I70 already makes the conditional false arm independent: the then-arm boundary
must be zero, its label is stack-neutral, and the final check starts the false
arm from zero. I71 therefore takes the next real path-aware omission and adds a
zero-depth invariant at the fixed loop's back edge. It changes no VKF syntax,
public API, ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i71/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`757EF780567538AA01C2B7AE9B6C3F4D803EFB4A0663072229B9EBD9B95B31A1`.

## Test-work isolation

Verification used the same packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i71/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 7 passed, 0 failed.

The RED mutates the loop body and exit block together: the body carries two
values across the back edge, while the exit block consumes one so the old
linear tracer still reaches final depth zero.

Command:

```powershell
node --test --test-name-pattern="body that leaves" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `unbalanced fixed-loop back edge produced output`.
- GREEN: 1 passed, 0 failed after adding `(depth = 0)?!` immediately after the
  back-edge jump instruction.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 40 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `7B98E16986DF2FD781D91D2263CD462D817BC18C1780BD583C5CE2284574BBDF`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `40E470D81C89BCA7D12DB1B6C03520FAD29C95E5B82665CA02C5F6126F8813FE`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate from linear
terminal balance toward path-aware loop validation. A malformed loop body can
no longer carry stack values into its next iteration and rely on the exit block
to make the linear trace appear balanced. It does not close the full gate.
