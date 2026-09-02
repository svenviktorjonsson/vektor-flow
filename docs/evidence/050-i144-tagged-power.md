# 050-I144 tagged-power evidence

## Scope

- Base: `3107aa2e`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I144 extends the connected tagged binary-expression path through the compiler
facade. The existing `^` syntax now enters the tagged token tape, retains its
identity through parser storage and typed IR, lowers to the existing
`power_f64` Machine-IR opcode, passes the existing numeric stack validator,
and is observable in the unchanged version-4 `MachineModule`.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED compiled `value0^4` through `.compiler`; the produced artifact exited with
status 3 because the tagged scanner rejected the already-public operator.

- intentional RED: 0/1 passed in 6.42 s; artifact exit status 3;
- focused GREEN: 1/1 passed in 6.71 s; opcode `power_f64`;
- source graph, canonical digests, addition tracer, validated Machine IR,
  subtraction, multiplication, division, remainder, and power: 9/9 passed in
  21.15 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 32.21 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

The bundle test used the preserved I140 bundle/frontend tools, the isolated
I135 strict compiler, and a temporary short drive alias mapped to this
worktree's `.work` directory. The alias was removed after the test.

## Contract hashes

- canonical `lexer.vkf` source:
  `B15BD45AF06DC1D0E574D7F1D122B5097B058D277AD48CF318D58A2B94EB6CA8`
- canonical `parser.vkf` source:
  `530AB4FA561478F3EFD7D253A1D75188AFBA706F016189F03E37AF1F2F67302B`
- canonical `typed_ir.vkf` source:
  `103CE49E6BA68D1F427DF05BED1F46C373DBEC8451A91C08A82DB3324943CD87`
- canonical `machine_ir.vkf` source:
  `AA6D18CB6F211CF539250274AE1D7B632DC2C4B1702AD74E74425303B7F510CC`
- canonical `machine_ir_validation.vkf` source:
  `4AA141F43F1357E5FC1A083C937D9B8D0E1743A56A1A0DD2CFFBE278649691AE`
- bootstrap bundle identity:
  `9EF066C94C9BCC95877DB629CA3164E98CF8215BDEA040681305F5319F0EA43F`
- tagged-power acceptance test:
  `588D50C2A0B349C3D9BAF616EA4BC36C19B9C869D2EB04E767EFFA21266E5F8C`
- bootstrap manifest file:
  `16C17105F6EC46D191D0ABB60493E6691D1F6A144D75EB21D5F4D6D5FCEBFEC5`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`
- reused I140 bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`

## Acceptance-gate impact

This adds one Gate-2 frontend identity and Gate-4 lowering/validation slice,
observed through the Gate-3 source-first compiler application. It does not
close a complete release gate. Full-module aggregate storage and Gate-6
Stage-2/Stage-3 fixed point remain open. Re-evaluated from I143, 0.5 remains
**70.1% total**, **+0.0 percentage points**.
