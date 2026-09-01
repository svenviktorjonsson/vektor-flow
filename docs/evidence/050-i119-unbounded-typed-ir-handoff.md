# 050-I119 unbounded typed-IR handoff evidence

## Scope

- Base: `1c0313e`
- RED: `8bb8f3d`
- GREEN: `1c822d8`
- Branch: `codex/0.5/050-i119-unbounded-typed-ir-handoff`

I119 connects I118's count-independent parsed module storage to the self-hosted
typed IR. The typed module owns the retained source, homogeneous statement
rows, and count. A typed binary expression is reconstructed only when its
index is demanded, preserving the unbounded and lazy representation instead
of creating another fixed aggregate alias.

The current executable tracer types identifier loads as `any`, integer number
literals as `int`, `+` as `PLUS`, and the resulting expression as `any`.
This changes no public VKF syntax, API, diagnostic, opcode, Machine-IR schema,
or ABI.

## TDD evidence

The RED probe failed because the typed-IR module exposed no direct handoff or
indexed typed statement operation. The GREEN probe passed all 32 statements
from lexer through parser into typed IR and demanded the first and last nodes.

The hidden executable produced:

```text
typed_module
32
binary_op
load
value0
any
PLUS
const
1
int
any
value31
32
```

Final evidence using the fresh I115 ownership-correct compiler:

- source graph, aggregate ownership, and full dependent tagged lexer/parser/
  typed-IR chain: 15/15 passed in 37.33 s;
- direct strict compile of `typed_ir.vkf`: exit 0 in 4141 ms;
- direct execution of the emitted typed-IR artifact: exit 0.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The typed module is now count-independent and demand-readable for the current
identifier-plus-number expression tracer. It has not yet lowered those dynamic
typed statements into Machine IR, and broader statement/type inference remains
open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119.
I119 commits are `8bb8f3d`, `1c822d8`, then this evidence commit. Do not merge
or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `typed_ir.vkf`:
  `D107E62FA7987BC46F87026F77872175C7A6AD1AEDACCA57EE1A01F9917BCC5F`
- bootstrap bundle identity:
  `C61628E19F44534E3FF22CBACF7A40F38A6A3B4C790AC7ECEE0EE8DC634F96D1`
- bootstrap manifest file:
  `1A75EA09943D507DE2BD9E3EBD3494C46E68FF5F2954CF29FE15ECA8BDB6B0B9`
- typed-IR handoff acceptance test:
  `7D24D9271A33DEFC2A52EBA9889535C2FC6A4E8D9089ECC7854CEA5BAB6504FD`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I119 typed-IR artifact:
  `93E3E0B095D0CF778B1615AC63984EA444B96018867B24F69DB3B01DE78D2B13`

## Acceptance-gate impact

The Stage-1 frontend now carries an arbitrary module from source through EOF
into typed IR without fixed statement aliases and materializes typed nodes on
demand. Dynamic Machine-IR lowering, broader grammar/type inference, the full
frontend, fixed point, stdlib ownership, and toolchain-free rebuild remain
open.
