# 050-I127 nested-addition encoding evidence

## Scope

- Base: `36927410`
- RED: `c3b0c10d`
- GREEN: `3afff3f3`
- Branch: `codex/0.5/050-i127-nested-addition`

I127 extends the executable Stage-1 tracer beyond one binary operation using
existing VKF syntax:

```vkf
value: 31
value + 1 + 2
```

The self-hosted lexer now continues an addition chain after a numeric operand.
A bounded nested-addition parser validates the exact binding/expression token
shape and matching identifier, typed IR records three integer operands, and
Machine IR emits `push 31`, `push 1`, `add`, `push 2`, `add`, `return`.
Self-hosted validation proves maximum stack depth two before the private Stage
bridge passes the module to the existing x64 encoder. The artifact prints `34`.

The tracer adds no public syntax, API, diagnostic, opcode, Machine-IR schema,
or ABI.

## TDD and regression evidence

RED reached the intended unknown private component only after the VKF-owned
lexer/parser/typed/MIR path compiled. GREEN verification with the isolated I127
compiler:

- nested-addition end-to-end encoding: 1/1 passed in 7.11 s;
- source graph and full dependent tagged lexer/parser/typed-IR/Machine-IR
  chain: 26/26 passed in 40.93 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 24.80 s;
- nested executable: exit 0, stdout `34`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

The first full-chain run found a fixed-layout specialization collision: the
generic `mir_function(... instructions:any ...)` call had conflated four- and
six-instruction arrays. Both private closed assemblers now construct the same
existing function fields directly, preserving each fixed layout. The rerun was
fully green without weakening validation.

## Deliberate boundary

This bounded tracer covers a two-operator addition with numeric literals and a
prior numeric binding. Arbitrary chain length, precedence/mixed operators,
parenthesized nesting, expression-valued bindings, broad grammar/type lowering,
the compiler fixed point, stdlib ownership, and toolchain-free rebuild remain
open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127. I127
commits are `c3b0c10d`, `3afff3f3`, then this evidence commit. Do not merge or
reset the original dirty I84 worktree.

## Contract hashes

- canonical `lexer.vkf`:
  `773861DF15F960EAFB1565C25C4869FC84BFCB6B938C05742ABFD621D0995E86`
- canonical `parser.vkf`:
  `B62A1E68829552FD4069330A9F6F9C8324E6878B3FA6314558E90BD07A9471B4`
- canonical `typed_ir.vkf`:
  `AA7C938E3374EC64508946BE2C6452563E54048C3431682C6E0BC859F162B958`
- canonical `machine_ir.vkf`:
  `0244EE641451D5FDA5079D4A80E53D4BDE44DE8222931C320F964803BBD83038`
- canonical `machine_ir_validation.vkf`:
  `706BEA236366FDCFB8ABB9445E883C89F6FFA8B41D17FEFCA771196A62F8A866`
- bootstrap bundle identity:
  `C6DB1D414DF690FE46F1C7CE35F213945B06E62967CEC76D4BBAB15C24EF96EC`
- bootstrap manifest file:
  `67DD24DE78FA240949E686A5F6A0B7F4B86DC5473CBB141D9E792C11EA3B7443`
- private Stage bridge source:
  `14BB22B08B9F86F2C52CA43DF0776C351E94A782C4F32404D1CA26D460779FC3`
- nested-addition acceptance test:
  `BEA7791E40E74C97BAF42A880155FF3DC18D1877486C0D837EA1058AB9D45020`
- isolated I127 `vkf-strict.exe`:
  `F85C6DA1FA4400124366360EE1C5B85B83C10437429B957469E28F570AED0151`

## Acceptance-gate impact

The executable Stage-1 tracer now closes and encodes a nested expression rather
than stopping at one binary operation. Against release gates, 0.5 is estimated
at **58.7% total**, **+1.2 percentage points** from I126's 57.5%.
