# 050-I145 tagged-floor-division evidence

## Scope

- Base: `b545d115`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I145 extends the connected tagged binary-expression path through the compiler
facade. The existing `//` syntax now enters the tagged token tape as one
two-scalar operator, retains its identity through parser storage and typed IR,
lowers to the existing `floor_divide_f64` Machine-IR opcode, passes the
existing numeric stack validator, and is observable in the unchanged
version-4 `MachineModule`.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED compiled `value0//4` through `.compiler`; the produced artifact exited
with status 3 because the tagged scanner treated the first slash as division.

The first GREEN attempt chained `cursor.advance().peek()` and correctly
failed strict direct lowering because that shape required an indirect call.
Binding the one-scalar advance before peeking kept the scanner source-first
and direct-call compatible.

- intentional RED: 0/1 passed in 9.16 s; artifact exit status 3;
- focused GREEN: 1/1 passed in 8.71 s; opcode `floor_divide_f64`;
- source graph, canonical digests, addition tracer, validated Machine IR,
  subtraction, multiplication, division, floor division, remainder, and
  power: 10/10 passed in 14.56 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 37.08 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

The bundle test used the preserved I140 bundle/frontend tools, the isolated
I135 strict compiler, and a temporary short drive alias mapped to this
worktree's `.work` directory. The alias was removed after the test.

## Contract hashes

- canonical `lexer.vkf` source:
  `21089DA1F304CE5A8CDAC98D899BE4F12EA44959907549F69ED22B8FD94E7856`
- canonical `parser.vkf` source:
  `3C478D95FFF4E8A6F5B86FCA402D82D701E2DE5AFDADD645EBCEFECC2CEE4A51`
- canonical `typed_ir.vkf` source:
  `815669E5E0CD986BAD1C2CA7092E9E371E61B656BFEDC81268C4C6CFB4046BD6`
- canonical `machine_ir.vkf` source:
  `C040F6FF53BEE267E4F5FEAA677968A674C7A0C4D4F381C82B8329B281C3CEBD`
- canonical `machine_ir_validation.vkf` source:
  `20989230F1ADDF9CD799F069A9D753762F498FCF5B3FB8E3F45C9F4A097CBBD1`
- bootstrap bundle identity:
  `FB71C1292F7EB7D720204C009AE329B522EB9D80A773300F5965DDA984EA6114`
- tagged-floor-division acceptance test:
  `12F88D521043E3044BDE441E3B942E2DEF5275CC17140ED606F56FD2E0687975`
- bootstrap manifest file:
  `6FE2C9D836E65C19D212BEE47537CE0EF608F699FCD42C0F116E229835A4E68B`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`
- reused I140 bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`

## Acceptance-gate impact

This adds one Gate-2 frontend identity and Gate-4 lowering/validation slice,
observed through the Gate-3 source-first compiler application. It does not
close a complete release gate. Full-module aggregate storage and Gate-6
Stage-2/Stage-3 fixed point remain open. Re-evaluated from I144, 0.5 remains
**70.1% total**, **+0.0 percentage points**.
