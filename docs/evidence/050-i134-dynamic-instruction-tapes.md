# 050-I134 dynamic instruction-tape evidence

## Scope

- Base: `3be3d8de`
- RED: `e1e4674c`
- GREEN: `7be1b6cf`
- Branch: `codex/0.5/050-i134-dynamic-machine-instructions`

I134 replaces the fixed eight-record producer for the derived dependency chain
with dynamic homogeneous opcode and value tapes. The count-independent opcode
tape is validated by I133, then projected into the unchanged private v4
MachineModule envelope for native encoding. The same source chain still
executes with stdout `33`.

No public syntax, API, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD and regression evidence

RED demanded dynamic instruction storage. A direct dynamic vector of instruction
records revealed two concrete backend gaps: record-vector `length()` and nested
field projection are not yet lowered. The GREEN representation uses parallel
homogeneous `[num]` opcode/value tapes, which are scalar-indexable and preserve
the complete instruction stream without weakening validation.

- dynamic instruction-tape dependency-chain encoding: 1/1 passed in 7.33 s;
- source graph and dependent self-hosting/ownership chain: 31/31 passed in
  50.65 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 26.46 s;
- executable: exit 0, stdout `33`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

The current private v4 envelope projection remains fixed at eight instructions
even though production and validation use dynamic tapes. Count-independent
envelope encoding, arbitrary dependency depth, dynamic record-vector backend
projection, broad grammar/type lowering, the fixed point, and toolchain-free
rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131 -> I132 -> I133 -> I134. I134 commits are
`e1e4674c`, `7be1b6cf`, then this evidence commit. Do not merge or reset the
original dirty I84 worktree.

## Contract hashes

- canonical `machine_ir.vkf`:
  `B0B88AFA1E3EC2DE53049B52EE2CE5B0093796DB8725CD04F07E0B1405ED4F15`
- bootstrap bundle identity:
  `25FF0755CCC8FB29C026B72FF8E3896B16F14B7A52A37A3FD5529765FD88AD50`
- bootstrap manifest file:
  `7D0AE25AC0429F0D87E803D5967904A00570C309EC233EB307E9C241DAECDA21`
- dependency-chain acceptance test:
  `82B544CC29FE6D4F9B75094DBDF4A760C9C260377ADDDBA791CCA5F24CD1D926`
- reused isolated I132 `vkf-strict.exe`:
  `5F23538487D709B92C60123E0DFC15EBB57465FC075400E1B8D9EEA96EBE576C`

## Acceptance-gate impact

Stage-1 dependency lowering now produces and validates count-independent
homogeneous instruction data before the private envelope boundary. Against
release gates, 0.5 is estimated at **65.8% total**, **+1.0 percentage point**
from I133's 64.8%.
