# 050-I89 normal function terminator evidence

## Scope

- Base: `66bc6ede795986f1f0b576d12e31b38ad550a0cd`
- RED: `128845c0ed9a4895dae2780714577d8631132e1e`
- Implementation: `4281f6921d94e17def5e65e761c950bc5193b68c`
- Branch: `codex/0.5/050-i89-normal-function-terminator-kind`
- Owned paths:
  - `compiler/self_hosted/machine_ir_validation.vkf`
  - `tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs`
  - `docs/evidence/050-i89-normal-function-terminator-kind.md`

A stack-equivalent `store_local` could replace the reusable numeric user
function's `return_f64` while satisfying terminal stack balance. I89 requires
that bounded function to end in `return_f64`. It changes no VKF syntax, public
API, ABI, schema, diagnostic text, or generated program output.

## Compiler and test isolation

Verification used the compatible I83 strict compiler, SHA-256
`BD87316B33B63B6CC6E98CD50411FFCDA3E233D9E8BAF00F97A3662315DA3CD5`,
Node.js `v24.11.0`, Windows `10.0.26200.0`, and the I89 worktree's 8.3 short
test-work path.

## TDD evidence

Focused command:

```powershell
node --test `
  --test-name-pattern="function without a return terminator" `
  tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs
```

- RED: 0 passed, 1 failed, 4,540.00 ms; failure:
  `unterminated numeric function produced output`.
- GREEN: 1 passed, 0 failed, 4,049.03 ms after requiring instruction 3 to be
  `return_f64`.

## Affected verification

The serial Stage-1 Machine IR validation and dispatch matrix used the normal,
conditional, and loop stack validators plus their validation and pipeline
dispatch tests. Result: 55 passed, 0 failed, 211,111.13 ms.

## Merge queue

I89 extends I88 because both own the same source validator and normal-module
test. Preserve this exact queue:

1. I83: `68d420e`, `aa8a774`.
2. clean I84: `261fbec`, `b7ec12f`, `251fe13`.
3. I85: `462cc0c`, `67e30db`, `24766e3`, `70be8ea`.
4. I86: `330f03a`, `6d980af`, `7a3250c`, `5ebc212`, `9200174`, `b29da02`.
5. I87: `51e9480`, `654edac`, `c5b127f`.
6. I88: `4be2b48`, `e41aa82`, `66bc6ed`.
7. I89: `128845c`, `4281f69`, then this evidence commit.

Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- `machine_ir_validation.vkf`:
  `0D96672E7827283240ABD49BF27AF4703E8D2072AE8C68324F3C37C48757F9C4`
- `stage1-machine-ir-stack-validation.test.mjs`:
  `0562246CE1B95447FF5BB3DB85548A073F606184651E836959DB614E36F7BF96`

## Acceptance-gate impact

The bounded normal-module validator now structurally proves the terminal
opcode for its entry, helper, and user function. This closes that fixed normal
module's terminator-kind slice, but not the general CFG validator or Stage 2 /
Stage 3 fixed-point gates.

Next packet: inspect the fixed-point acceptance DAG for the next bounded
source-owned structural proof rather than widening public contracts.
