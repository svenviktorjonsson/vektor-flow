# 050-I88 normal helper terminator evidence

## Scope

- Base: `c5b127f37184805fb99ee94da6f72281ae63a682`
- RED: `4be2b48e2023c41e77e8b1c19e1e37e2c64f9042`
- Implementation: `e41aa8246e6d6bdb27b13483e310bebcc58e5733`
- Branch: `codex/0.5/050-i88-normal-helper-terminator-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs`
  - `docs/evidence/050-i88-normal-helper-terminator-kind.md`

The reusable numeric validator already required a zero terminal stack, but a
stack-equivalent `store_local` could replace the CPU-count helper's
`return_f64` and still publish output. I88 requires this bounded helper to end
in `return_f64`. It changes no VKF syntax, public API, ABI, schema, diagnostic
text, or generated program output.

## Compiler and test isolation

Verification used the compatible I83 strict compiler:

- SHA-256:
  `BD87316B33B63B6CC6E98CD50411FFCDA3E233D9E8BAF00F97A3662315DA3CD5`
- Node.js: `v24.11.0`
- Windows: `10.0.26200.0`

`VKF_TEST_WORK_ROOT` used the I88 worktree's 8.3 short path.

## TDD evidence

Focused command:

```powershell
node --test `
  --test-name-pattern="helper without a return terminator" `
  tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed, 1,978.21 ms; failure:
  `unterminated numeric helper produced output`.
- GREEN: 1 passed, 0 failed, 3,731.27 ms after requiring instruction 1 to be
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

Result: 54 passed, 0 failed, 172,082.73 ms.

## Merge queue

I88 extends I87 because both own the same source validator and normal-module
test. Preserve the existing queue and apply I88 only after I87:

1. I83: `68d420e`, `aa8a774`.
2. clean I84: `261fbec`, `b7ec12f`, `251fe13`.
3. I85: `462cc0c`, `67e30db`, `24766e3`, `70be8ea`.
4. I86: `330f03a`, `6d980af`, `7a3250c`, `5ebc212`, `9200174`, `b29da02`.
5. I87: `51e9480`, `654edac`, `c5b127f`.
6. I88: `4be2b48`, `e41aa82`, then this evidence commit.

Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- `machine_ir_validation.vkf`:
  `5C3C41C6EE6817F2524434EC14AF211E35E261A8315DDFD1D1C6FF0658D1616A`
- `stage1-machine-ir-stack-validation.test.mjs`:
  `3D677DD38B45C1CC329CE602DE39955256A0884563998785DEDD95113EEEFE18`

## Acceptance-gate impact

This advances the bounded source-owned Machine IR validator toward a structural
normal-control-flow proof: terminal stack balance can no longer hide a missing
helper return. It does not close the general CFG validator or Stage 2/Stage 3
fixed-point gates.

Next packet: require the reusable numeric user function to end in
`return_f64`.
