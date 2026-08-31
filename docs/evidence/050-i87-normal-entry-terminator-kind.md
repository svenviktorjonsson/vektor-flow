# 050-I87 normal entry terminator evidence

## Scope

- Base: `aa8a774e6cee7f6f27ab5307e0eca2568e8b82e2`
- RED: `51e9480ee307c3d613b8c98c85eeed36b99bf904`
- Implementation: `654edacb7f39d022d4d4763d5389b973d4379822`
- Branch: `codex/0.5/050-i87-normal-entry-terminator-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs`
  - `docs/evidence/050-i87-normal-entry-terminator-kind.md`

The reusable numeric validator already required a zero terminal stack, but a
stack-equivalent `store_local` could replace the entry's `return_f64` and still
publish output. I87 requires the bounded normal entry to end in `return_f64`.
It changes no VKF syntax, public API, ABI, schema, diagnostic text, or generated
program output.

## Compiler and test isolation

Verification used the compatible I83 strict compiler:

- SHA-256:
  `BD87316B33B63B6CC6E98CD50411FFCDA3E233D9E8BAF00F97A3662315DA3CD5`
- Node.js: `v24.11.0`
- Windows: `10.0.26200.0`

`VKF_TEST_WORK_ROOT` used the I87 worktree's 8.3 short path. The first attempted
long work path hit Windows path length before reaching the validator and is not
counted as RED evidence.

## TDD evidence

Focused command:

```powershell
node --test `
  --test-name-pattern="without a return terminator" `
  tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed, 1715.80 ms; failure:
  `unterminated numeric entry produced output`.
- GREEN: 1 passed, 0 failed, 3595.83 ms after requiring instruction 2 to be
  `return_f64`.

## Affected verification

The Stage-1 Machine IR validation and dispatch matrix ran serially:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs `
  tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs `
  tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs `
  tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs `
  tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs `
  tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs `
  tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs `
  tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs `
  tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 53 passed, 0 failed, 173,107.40 ms.

## Merge queue

I87 was based on reviewed I83 state because it owns the same source validator.
Its two implementation commits remain path-disjoint from I84-I86. Preserve the
existing queue and apply I87 only after it:

1. I83: `68d420e`, `aa8a774`.
2. clean I84: `261fbec`, `b7ec12f`, `251fe13`.
3. I85: `462cc0c`, `67e30db`, `24766e3`, `70be8ea`.
4. I86: `330f03a`, `6d980af`, `7a3250c`, `5ebc212`, `9200174`, `b29da02`.
5. I87: `51e9480`, `654edac`, then this evidence commit.

Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- `machine_ir_validation.vkf`:
  `3ADBD7920D339E802650E251102BD6EEA7E3B16DA25363CBFA9156A1CF0290C3`
- `stage1-machine-ir-stack-validation.test.mjs`:
  `80B104F206C19DCC7F1E2DCAE31419CDE25441AB4597E6848F0AF34E56CDAAD4`

## Acceptance-gate impact

This advances the bounded source-owned Machine IR validator toward a structural
normal-control-flow proof: terminal stack balance can no longer hide a missing
entry return. It does not close the general CFG validator or Stage 2/Stage 3
fixed-point gates.

Next packet: require the reusable numeric helper and numeric function bodies to
end in `return_f64`, one observable terminator at a time.
