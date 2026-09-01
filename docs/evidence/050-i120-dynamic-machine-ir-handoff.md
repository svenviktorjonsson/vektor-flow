# 050-I120 dynamic Machine-IR handoff evidence

## Scope

- Base: `07e2377`
- RED: `33b04b0`
- GREEN: `a6f2c54`
- Branch: `codex/0.5/050-i120-dynamic-machine-ir-handoff`

I120 connects I119's count-independent typed module storage to Machine IR.
The Machine-IR staging module owns the retained source, homogeneous statement
rows, and count. Demanding a statement emits a uniform four-instruction
projection using the existing instruction vocabulary: `load_local`,
`push_f64`, `add_f64`, and `return_f64`.

The narrow internal instruction projection makes fields statically displayable
and preserves the exact Machine-IR operation semantics without changing the
public version-4 MachineModule schema. No public VKF syntax, API, diagnostic,
opcode, schema, or ABI changes.

## TDD evidence

The RED probe failed because the Machine-IR module exposed no dynamic typed
handoff or indexed lowering operation. The GREEN probe passed all 32 statements
through lexer, parser, typed IR, and Machine IR, then demanded the first and
last instruction sequences.

The hidden executable produced:

```text
32
value0
load_local
0
push_f64
1
add_f64
return_f64
2
value31
32
```

Final evidence using the fresh I115 ownership-correct compiler:

- source graph, ownership, and focused unbounded frontend chain: 8/8 passed in
  15.89 s;
- established typed-module producer and stack-validation suites: 12/12 passed
  in 35.54 s;
- direct strict compile of `machine_ir.vkf`: exit 0 in 2920 ms;
- direct execution of the emitted Machine-IR artifact: exit 0.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The current identifier-plus-number expression tracer now reaches real
Machine-IR operation kinds without a fixed statement-count alias. Validation
and executable encoding of this dynamic projection, broader expression/
statement lowering, and complete entry/function assembly remain separate
slices.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120. I120 commits are `33b04b0`, `a6f2c54`, then this evidence commit. Do
not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `machine_ir.vkf`:
  `BD986BCE0B3806B6B1F60E09F714728FC4AEC6FF09DA678B5C0C0A46B410929A`
- bootstrap bundle identity:
  `3E9B0B43DCA67911FCB6BE9FA1AA2D74EDD12EF86CECF66BA0F22679A5C648A9`
- bootstrap manifest file:
  `4A3EF21B61A3E9B2637F5597B749CC55C4E391ADD146CE17C29293C319C10089`
- Machine-IR handoff acceptance test:
  `CCBAEF7196F488670E40658988AABD36E48E66017E05E74EA8B2FC4C0F0A912B`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I120 Machine-IR artifact:
  `C03D6833B0063DA62A455A11F559E827F51A7FFDB02D7480E2740651E8CF500E`

## Acceptance-gate impact

The Stage-1 tracer now carries an arbitrary source module through lexer,
parser, typed IR, and into demand-lowered Machine IR without fixed statement
aliases. Dynamic validation/encoding, broader grammar/type lowering, the full
compiler fixed point, stdlib ownership, and toolchain-free rebuild remain open.
