# 050-I132 deeper binding-chain evidence

## Scope

- Base: `fc6fad0c`
- RED: `238e6547`
- GREEN: `bb8c439f`
- Branch: `codex/0.5/050-i132-two-derived-bindings`

I132 extends the existing binding tracer to two derived dependencies:

```vkf
base: 30
first: base + 1
second: first + 1
second + 1
```

The bounded self-hosted parser proves all three source-order name links, typed
IR retains four numeric operands, and Machine IR closes the chain as eight
instructions: `push 30`, three `push 1`/`add` steps, then `return`. The
self-hosted validator proves maximum stack depth two before the private Stage
bridge passes the zero-parameter v4 module to the existing x64 encoder. The
artifact prints `33`.

No public syntax, API, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD and regression evidence

RED failed in the intended unsupported self-hosted source shape. The first
GREEN probe also exposed that dynamic indexing of a local string vector is not
yet lowered by the direct backend. The bounded eight-step validator was
therefore unrolled without weakening stack semantics; the previous compiler
then reached only the expected unknown I132 private bridge.

- deeper dependency-chain encoding: 1/1 passed in 7.94 s;
- source graph and full dependent tagged lexer/parser/typed-IR/Machine-IR
  ownership chain: 31/31 passed in 53.26 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 26.95 s;
- dependency-chain executable: exit 0, stdout `33`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

This tracer remains bounded to two derived numeric bindings. Arbitrary dynamic
dependency depth, cycles, general expression-valued storage, broad grammar/type
lowering, the compiler fixed point, stdlib ownership, and toolchain-free rebuild
remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131 -> I132. I132 commits are `238e6547`, `bb8c439f`,
then this evidence commit. Do not merge or reset the original dirty I84
worktree.

## Contract hashes

- canonical `lexer.vkf`:
  `6DFF4027B4D56C4CF24F2A3E4EA1BAC6C48D075BB5E41A29DBFCAF1D56BA97AC`
- canonical `parser.vkf`:
  `71D7EAC671309177DBA548F4F0D26DC429DB1799FFD4710D9CFE19E7E4C57CDF`
- canonical `typed_ir.vkf`:
  `68F87B2717FBE7B2FED7FE068AAD8B6A95509E161E4F9B5653B5045C76C5AECD`
- canonical `machine_ir.vkf`:
  `7A8AFFF2544D38198060B4E37DF0BD656133101749EC1F19A77A73B8C631E07E`
- canonical `machine_ir_validation.vkf`:
  `1C430F5A4A384C2C5B8A116B001BC10E12AA85528DA77ED135EA0EC16952E10A`
- bootstrap bundle identity:
  `91385BD87F2D6262D41566E73302C2360937FCAC35698141900E017573732FB4`
- bootstrap manifest file:
  `05C31F2690CDE8E4932AB7C93989F280073DA4C80DD259F0F4E96C98259F693E`
- private Stage bridge source:
  `0B9454C1A25CD14730EA758641CC9FB119DDEEBA30D46DF2FC9A760ADBD30FAE`
- dependency-chain acceptance test:
  `AB16F71F86ED2CF0B665F078117F8D6C97394C1CF3F2A34EB4ED130F632B6D7F`
- isolated I132 `vkf-strict.exe`:
  `5F23538487D709B92C60123E0DFC15EBB57465FC075400E1B8D9EEA96EBE576C`

## Acceptance-gate impact

The executable Stage-1 tracer now closes a multi-hop derived dependency chain
through validation and encoding. Against release gates, 0.5 is estimated at
**63.8% total**, **+1.3 percentage points** from I131's 62.5%.
