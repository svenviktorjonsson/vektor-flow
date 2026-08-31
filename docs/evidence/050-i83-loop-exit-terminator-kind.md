# 050-I83 loop exit-block terminator evidence

## Scope

- Base: `c93606dbfcfab0c504eaa4ada259b4505a136271`
- Implementation: `68d420e2336b125f4fb5e70b37c7914d43e93428`
- Branch: `codex/0.5/050-i83-loop-exit-terminator-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs`
  - `docs/evidence/050-i83-loop-exit-terminator-kind.md`

The existing final balance check establishes exit-block stack balance, but a
stack-equivalent non-terminator could still satisfy that boundary. I83 requires
the fixed loop exit block to end in `return_f64`. It changes no VKF syntax,
public API, ABI, schema, diagnostic text, or generated program output.

## Current compiler build

The strict compiler was built from the packet base through the repaired helper:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i83/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`BD87316B33B63B6CC6E98CD50411FFCDA3E233D9E8BAF00F97A3662315DA3CD5`.

## Test-work isolation

Verification used the packet worktree through its 8.3 short path:

```powershell
$short=(cmd /c 'for %I in (.) do @echo %~sI').Trim()
$env:VKF_TEST_WORK_ROOT=(Join-Path $short '.work')
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i83/bin').Path
```

No test data was written outside the packet worktree.

## TDD evidence

Baseline command:

```powershell
node --test tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

Result: 14 passed, 0 failed.

The RED replaces the exit block's `return_f64` with `store_local`. Both consume
one stack value, so the final linear stack boundary remains zero while the
malformed non-terminating exit block produces output.

Command:

```powershell
node --test --test-name-pattern="exit block is not" tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed; failure:
  `unterminated fixed-loop exit block produced output`.
- GREEN: 1 passed, 0 failed after requiring the exit-block terminator kind to
  equal `return_f64`.

## Affected verification

The affected matrix ran serially to avoid load-sensitive artifact timeouts:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 52 passed, 0 failed.

## Contract hashes

- `machine_ir_validation.vkf`:
  `F2A05736D753ABBD4400D8D355367B15D81B01EEDE1D659934B2A7CD3ADAE3C1`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `C5405C1FD7E346F2EF30B2888216AB468307B5C461EA3CB7EFE00059DD9F2FE8`

## Acceptance-gate impact

This advances the 0.5.0 canonical Machine IR/optimizer/target gate toward
structurally sound fixed-CFG terminator validation. Stack equivalence can no
longer mask a missing return from the fixed loop exit block. It does not close
the full gate.
