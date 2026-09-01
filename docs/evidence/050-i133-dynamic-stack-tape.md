# 050-I133 dynamic stack-tape evidence

## Scope

- Base: `9c45b1d7`
- RED: `d193168c`
- GREEN: `b5f8c251`
- Branch: `codex/0.5/050-i133-dynamic-stack-tape`

I133 replaces the fixed eight-string validation seam from I132 with a dynamic
homogeneous numeric opcode tape. Existing instruction kinds are translated to
stack-effect codes; a count-independent loop validates the `[num]` tape,
detects unsupported codes, underflow and final imbalance, and computes maximum
stack depth. The two-derived-binding tracer now uses this path before encoding
the same zero-parameter v4 module and still prints `33`.

No public syntax, API, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD and regression evidence

RED showed the previous compiler could not resolve the new validator. The
first implementation probe correctly exposed that an inferred `[num:8]` cannot
cross the dynamic `[num]` function ABI. Declaring the producer tape as `[num]`
exercised the intended count-independent representation and made the tracer
green.

- dynamic opcode-tape dependency-chain encoding: 1/1 passed in 8.97 s;
- source graph and dependent self-hosting/ownership chain: 31/31 passed in
  56.20 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 29.83 s;
- executable: exit 0, stdout `33`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

The instruction producer remains a bounded eight-instruction tracer even
though validation is now count-independent. Dynamic instruction production,
arbitrary dependency depth, call opcode argument/result metadata, broad
grammar/type lowering, the fixed point, and toolchain-free rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131 -> I132 -> I133. I133 commits are `d193168c`,
`b5f8c251`, then this evidence commit. Do not merge or reset the original dirty
I84 worktree.

## Contract hashes

- canonical `machine_ir_validation.vkf`:
  `36B8B7C22731A85E6399EFB86EC1F652A6FA7B947724116D0AFD20BE06EF1AE1`
- bootstrap bundle identity:
  `F48C0A53ED02D88DE63A9B080F5761E6E5BB304E7AE4F9D1E715BB01FAC4EC22`
- bootstrap manifest file:
  `47308C13E73ECAED98DB1FAAF1C6278E81A4329608B76745EC2A5AA9F3E34601`
- dependency-chain acceptance test:
  `14F3C4711817CBE1CCD102D877FC58322AF906C25F40FF7EF6CED5939A450F9F`
- reused isolated I132 `vkf-strict.exe`:
  `5F23538487D709B92C60123E0DFC15EBB57465FC075400E1B8D9EEA96EBE576C`

## Acceptance-gate impact

Stage-1 stack validation is no longer tied to one fixed instruction count,
removing a concrete blocker to dynamic statement lowering. Against release
gates, 0.5 is estimated at **64.8% total**, **+1.0 percentage point** from
I132's 63.8%.
