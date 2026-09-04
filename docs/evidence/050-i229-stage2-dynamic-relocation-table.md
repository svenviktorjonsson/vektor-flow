# 050-I229 Stage-2 dynamic relocation table evidence

## Scope and behavior

- Git base: `7b2f3b0abb9b0b9c0294fe9df43e5f4b73636c8b` (I228)
- Worktree: `.worktrees/0.5/050-i229-stage3-dynamic-relocation-table`
- Branch: `codex/0.5/050-i229-stage3-dynamic-relocation-table`
- State: GREEN, ready for exact-scope commit

I229 replaces the fixed two-entry relocation seam with one internal
variable-cardinality Stage-2 x64 table applicator. The applicator accepts
artifact fragments plus equally sized origin and target containers, validates
their cardinality, and iterates once per signed `rel32` entry. The I228 pair
writer now uses this same path at cardinality two; the I229 tracer exercises it
at cardinality three.

The three-source executable chain lowers helpers at offsets 2, 22, and 42 and
discovers its entry at offset 62. Call origins 69, 80, and 91 resolve to
displacements `-67`, `-58`, and `-49`, encoded as `E8 BD FF FF FF`,
`E8 C6 FF FF FF`, and `E8 CF FF FF FF`. The entry jump is `EB 3C`.
The caller supplies sources and immutable instruction fragments, never symbol
positions, table cardinality, or relocation displacements.

Stage 0, Stage 2, and Stage 3 print exact `42`. Stage-2 and Stage-3 programs
are byte-identical; Stage-2, Stage-3, and Stage-4 compiler artifacts are
byte-identical. Generated compiler source contains neither internal stage
observation nor `process.run_native`.

This is an internal relocation applicator, not a public relocation schema or a
general object/container writer. Arbitrary source-module symbol discovery,
branches, data relocations, section layout, and PE/ELF/Mach-O writing remain
open. No public syntax, semantics, API, diagnostic, manifest schema, ABI, UI,
renderer, or native implementation changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the complete six-file ignored
seed/smoke bin set came from I228. Tests used
`VKF_TEST_WORK_ROOT=C:\w\vf-i229`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i229'
node --test tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 19.61 s; the missing private chain writer was rejected
  as `direct x64 backend unsupported: machine IR supports direct calls only`
  before artifact creation.
- initial GREEN: exit `0`, 1/1 in 24.62 s.
- post-GREEN refactor check, exercising the same dynamic applicator through
  two- and three-entry public artifact tests: exit `0`, 2/2 in 43.44 s.

Final adjacent matrix (`node --test --test-concurrency=1`) covered dynamic
cardinalities two and three, I227 symbol discovery, backward and forward
relocation, the original artifact seam, high-byte imm32, the complete integer
writer, and source/bundle hash checks:

- exit `0`, 10/10 in 158.11 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 16.16 s;
- complete ten-source executable bundle: exit `0`, 1/1 in 47.82 s.

No timeout, assertion, byte oracle, or performance gate was weakened. This
correctness packet makes no performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `BFDFCD5CAEF4B544B512F09D7871A44DAD795EEC93CEAFD1FAAE28213D7DDB5C`
- bootstrap manifest canonical bytes:
  `2A5B7092FA2DA08398693EB4D04F701369FB9A49602B2B5C2849237B3DD75C42`
- canonical compiler facade source:
  `6BE2C3DC0A1FE3BF3F9FA8F45CFE904E0CFC6A77C0F8BBC1195443E612CAB422`
- I229 acceptance test canonical bytes:
  `2D7499A127173B55875ADD0F6657E37C5840878C8E3FAFFC6E777D1CA0860F0F`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I229 advances ADR 0005 rules 3, 4, and 5 by removing fixed relocation-table
cardinality from the Stage-2 application seam. It does not close a whole rule
or claim general artifact writing.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. The next genuine RED
should expose the earliest compiler-owned section-layout/container-encoding
primitive or arbitrary source symbol discovery required before it. Full suite
equivalence, stdlib/UI migration, fallback removal, and the seed-only
toolchain-free rebuild remain.
