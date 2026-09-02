# 050-I143 tagged-remainder evidence

## Scope

- Base: `b6d3c107`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I143 extends the connected tagged binary-expression path through the compiler
facade. The existing `%` syntax now enters the tagged token tape, retains its
identity through parser storage and typed IR, lowers to the existing
`remainder_f64` Machine-IR opcode, passes the existing numeric stack
validator, and is observable in the unchanged version-4 `MachineModule`.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED compiled `value0%4` through `.compiler`; the produced artifact exited with
status 3 because the tagged scanner rejected the already-public operator.

- intentional RED: 0/1 passed in 10.26 s; artifact exit status 3;
- focused GREEN: 1/1 passed in 6.86 s; opcode `remainder_f64`;
- source graph, canonical digests, addition tracer, validated Machine IR,
  subtraction, multiplication, division, and remainder: 8/8 passed in
  16.94 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 25.94 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

The bundle test used the preserved I140 bundle/frontend tools, the isolated
I135 strict compiler, and a temporary short drive alias mapped to this
worktree's `.work` directory. The alias was removed after the test.

## Contract hashes

- canonical `lexer.vkf` source:
  `7DF12D4B936CD93E43339F36B125178360A568B0D3C19964EAC28B265A1C3C9E`
- canonical `parser.vkf` source:
  `CF5C09AE4842C532EFADCB446BB8A35FB86C256ACEEB8E93B8AAC4CBE96EB295`
- canonical `typed_ir.vkf` source:
  `41A8D21EC4D9F16B60338B773B95308587118804EF505FF86C6810AFD5F8827F`
- canonical `machine_ir.vkf` source:
  `AB129F9345DFF1B1DEA2623654F61AB715F08DD15D2933AABE90C9CB18070F1E`
- canonical `machine_ir_validation.vkf` source:
  `ACDA2AE2FEF4DE29A28CD93AB93E404BAEAB46D3CA18EC1EF4CA300962DD8622`
- bootstrap bundle identity:
  `D2C0829CB2B6896D9EC34238D12C711214C7AF657A9349658F5D05548DAE8614`
- tagged-remainder acceptance test:
  `037B6D5C0320C9C4659C077FDB717F5D7D04A0555915997A233FE78AC0EB1854`
- bootstrap manifest file:
  `05EAB7105CBD86DC94A2D8EA3587032C4DB8A37A5C6BA1ED1C59AE1BA1EFB1E7`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`
- reused I140 bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`

## Acceptance-gate impact

This adds one Gate-2 frontend identity and Gate-4 lowering/validation slice,
observed through the Gate-3 source-first compiler application. It does not
close a complete release gate. Full-module aggregate storage and Gate-6
Stage-2/Stage-3 fixed point remain open. Re-evaluated from I142, 0.5 remains
**70.1% total**, **+0.0 percentage points**.
