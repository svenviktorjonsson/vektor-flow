# 050-I135 dynamic envelope-handoff evidence

## Scope

- Base: `97cb00a3`
- RED: `beb89842`
- GREEN: `66f2d9f5`
- Branch: `codex/0.5/050-i135-dynamic-envelope`

I135 removes the fixed eight-instruction observation at the final private
Stage-1-to-native handoff. The VKF producer now sends its validated instruction
count plus homogeneous numeric opcode and value tapes. The private native
consumer checks the count, reconstructs instructions dynamically, and passes
the unchanged version-4 `MachineModule` to existing validation and encoding.

The acceptance test executes both the original eight-operation dependency
chain (`33`) and an independent four-operation tape (`42`). This proves the
consumer is not specialized to one instruction count.

No public syntax, API, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD and regression evidence

RED changed the producer contract first; the previous private consumer rejected
the counted dynamic observation. A bounded range-output probe also exposed that
effectful statements inside this Stage-1 distribution are not retained by the
current direct backend. GREEN therefore transports the already-established
homogeneous vectors as two private structural leaves and parses them by their
declared count. No backend rule was weakened.

- fresh hidden `vkf-strict.exe` build: passed;
- focused dynamic envelope test: 1/1 passed in 8.00 s;
- source graph and dependent self-hosting/ownership chain: 31/31 passed in
  53.48 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 36.13 s;
- executable observations: exit 0, stdout `33` and `42`;
- all child processes hidden; no performance workload or shared benchmark root
  used.

## Deliberate boundary

The traced grammar still covers a narrow existing-syntax arithmetic subset,
and the private tape currently carries push, add, and return opcodes only.
Arbitrary dependency depth, broader typed operations/control flow through the
same dynamic handoff, the Stage-1-to-Stage-2 fixed point, and a toolchain-free
rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131 -> I132 -> I133 -> I134 -> I135. I135 commits are
`beb89842`, `66f2d9f5`, then this evidence commit. Do not merge or reset the
original dirty I84 worktree.

## Contract hashes

- canonical `machine_ir.vkf` source declared by the bootstrap manifest:
  `B0B88AFA1E3EC2DE53049B52EE2CE5B0093796DB8725CD04F07E0B1405ED4F15`
- bootstrap bundle identity:
  `25FF0755CCC8FB29C026B72FF8E3896B16F14B7A52A37A3FD5529765FD88AD50`
- canonical bootstrap manifest Git bytes:
  `4FB0922144B8590FBCA67FAD56CE97943B5B3EAE0087AAA6950A5BCFC1344102`
- private native consumer:
  `1C004F62B3551EBC751E75E95430E59F39370EFB550218A348ADFC90DD4962A3`
- dependency-chain acceptance test:
  `1865E95FBF5AD439C5B28283775742DB371D65255E45E4FAD33F6F73D70D58CF`
- fresh isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`

## Acceptance-gate impact

Stage-1 dynamic instruction data now crosses its final private native boundary
without a fixed instruction-count alias, while the public v4 envelope remains
unchanged. Re-evaluated against the release gates, 0.5 is estimated at **67.0%
total**, **+1.2 percentage points** from I134's 65.8%.
