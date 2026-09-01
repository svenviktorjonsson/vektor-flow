# 050-I139 tagged-subtraction evidence

## Scope

- Base: `12d9b180`
- RED: `494a74d7`
- GREEN: `99692ae7`
- Branch: `codex/0.5/050-i139-tagged-subtraction`

I139 extends the existing tagged binary-expression slice through the connected
compiler facade. The already-recognized minus token now retains its operator
identity through parser storage and typed IR, lowers to the existing
`subtract_f64` Machine-IR opcode, passes the existing stack validator, and is
observable in the unchanged version-4 `MachineModule` returned by
`compile_tagged_module_statement`.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED compiled `value0-1` through `.compiler` and proved that the previous path
incorrectly emitted `add_f64`. GREEN threads the existing operator through the
established self-hosted phases without a native-backend exception or fallback.

- intentional RED: 0/1 passed in 10.54 s, actual opcode `add_f64`;
- focused GREEN: 1/1 passed in 10.64 s, opcode `subtract_f64`;
- source graph and focused compiler/tagged-MIR chain: 7/7 passed in 42.95 s;
- tagged frontend, compiler facade, conditional, and loop chain: 66/67 passed
  in 184.46 s under four-way concurrency; the one loop back-edge probe timed
  out while executing its artifact and passed alone, 1/1 in 7.47 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 40.18 s;
- canonical bootstrap-manifest generation check passed;
- all child processes were hidden and no performance workload ran.

The bundle test used a temporary short drive alias mapped to this isolated
worktree to avoid the known Windows path limit. The alias was removed after the
test.

## Packet selection and deliberate boundary

The first selected packet, I138, demands all non-entry functions in
`MachineModule.functions`. Its committed RED remains isolated at `7d7e0604` on
`codex/0.5/050-i138-full-module-functions`. The direct x64 compiler rejected
the first implementation at its existing aggregate-width seam when a dynamic
list attempted to grow from width 1 to the 26-lane `MachineFunction` record.
That packet is preserved and is not in this merge queue; solving it requires a
separate internal aggregate-list representation packet.

I139 therefore takes the next ready frozen-contract vertical path. The tagged
frontend remains a narrow binary-statement subset, and the compiler facade
still demand-lowers one statement rather than assembling all module functions.
General source and diagnostics, full module symbol resolution, complete
compiler MIR, compiler-owned artifact writing, Stage-1 invocation over the
locked graph, Stage-2 production, and fixed-point equivalence remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131 -> I132 -> I133 -> I134 -> I135 -> I136 -> I137
-> I139. I139 commits are `494a74d7`, `99692ae7`, then this evidence commit.
Do not merge I138 or reset the original dirty I84 worktree.

## Contract hashes

- canonical `parser.vkf` source:
  `B1DC6A077A5483FC8E44165F916C78F2B15FBC374388CEDE05A2B522342B36AB`
- canonical `typed_ir.vkf` source:
  `DEE0DB330B6522AE30F58275812A41164D8239DA0C3E24DBF1F75AE5BD11B7FB`
- canonical `machine_ir.vkf` source:
  `2C8D5B11648CA6C0A2F46B8B0E38EDB8A8D4276BEF1BF09BE6DEC199D2327E7C`
- bootstrap bundle identity:
  `B86A1A34FEE46950A6A7BCFE5BB9E3D669143EEDB17FAE61530994926E850E60`
- canonical bootstrap manifest Git bytes:
  `EB78AE566EAC2BC8761E50B2F64038BAED1B20356599480876C76A10CBD555FF`
- tagged-subtraction acceptance test:
  `E748D92A0F19F0DF325FF301BD54F14EC9B3F1811D7DC752C7909BDC84169339`
- reused bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`

## Acceptance-gate impact

The connected self-hosted compiler no longer collapses every recognized tagged
binary statement to addition: subtraction survives all established phases and
the locked executable graph remains truthful. Re-evaluated against the release
gates, 0.5 is estimated at **70.1% total**, **+0.5 percentage points** from
I137's 69.6%.
