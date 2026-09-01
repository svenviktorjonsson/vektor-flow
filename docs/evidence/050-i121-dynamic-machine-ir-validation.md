# 050-I121 dynamic Machine-IR validation evidence

## Scope

- Base: `4c6c86d`
- RED: `58bb6c5`
- GREEN: `cddaeed`
- Branch: `codex/0.5/050-i121-dynamic-machine-ir-validation`

I121 applies the existing self-hosted numeric stack-effect rules to I120's
demand-lowered dynamic statement projection. Both the first and last of a
32-statement module validate to maximum stack depth 2 and balanced exit depth.
A malformed instruction order is rejected for stack underflow before assembly.

The implementation reuses the established `machine_ir_numeric_stack_depth`
operation and its existing diagnostic. It changes no public VKF syntax, API,
diagnostic, opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED tests failed because no dynamic statement validator existed. The GREEN
positive probe produced:

```text
2
2
32
```

The negative probe embeds the existing `machine IR stack underflow` diagnostic,
exits nonzero, and emits no output.

Final evidence using the fresh I115 ownership-correct compiler:

- source graph, ownership, dynamic Machine-IR lowering, and validation: 6/6
  passed in 13.77 s;
- established typed-module producer and stack-validation suites: 12/12 passed
  in 28.66 s;
- direct strict compile of `machine_ir_validation.vkf`: exit 0 in 6282 ms;
- direct execution of the emitted validation artifact: exit 0.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The dynamic instruction projection is now validated before assembly. It is not
yet assembled into a complete public version-4 MachineModule or encoded into a
standalone generated program. Broader statement lowering remains open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121. I121 commits are `58bb6c5`, `cddaeed`, then this evidence
commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `machine_ir_validation.vkf`:
  `733CAF7882959744FFE71B8438EB979039AC8D8D57C61FEEC01F89FCA56B18C2`
- bootstrap bundle identity:
  `46899D0C9C771F65E1C7FADF8255F161A7FF7663906554CCEC4C3FB937D55EB0`
- bootstrap manifest file:
  `93C82B353515DD55335D08C303D1A1A784AFA65624806A9EFCA2FBB78720E3F1`
- dynamic-validation acceptance test:
  `69BE509BB78EF1E4E57307AFE3D260431E2D9CACD4454E3F9D8FB6C8258BAA89`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I121 validation artifact:
  `375B8D9A5C4DDF4A617EBC32BF021E7C39AEFBC200E4D5D83E89D7B927058F28`

## Acceptance-gate impact

The count-independent Stage-1 tracer now reaches validated Machine IR for an
arbitrary current-form module. Complete MachineModule assembly/encoding,
broader grammar and lowering, the compiler fixed point, stdlib ownership, and
toolchain-free rebuild remain open.
