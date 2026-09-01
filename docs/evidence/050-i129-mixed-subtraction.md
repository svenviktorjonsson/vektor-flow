# 050-I129 mixed-subtraction encoding evidence

## Scope

- Base: `2fc34ccb`
- RED: `51c8dac6`
- GREEN: `16843c51`
- Branch: `codex/0.5/050-i129-subtraction`

I129 carries the already-supported subtraction operator across the executable
Stage-1 tracer:

```vkf
value: 31
value + 3 - 1
```

The self-hosted lexer retains `-`, the bounded parser preserves the existing
left-to-right additive rule, typed IR retains all operands, and Machine IR
emits `push 31`, `push 3`, `add`, `push 1`, `subtract`, `return`. The
self-hosted stack validator now accepts the existing `subtract_f64` opcode and
proves maximum stack depth two before the private Stage bridge passes the
closed zero-parameter v4 module to the existing x64 encoder. The artifact
prints `33`.

No public syntax, API, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD and regression evidence

RED failed in the intended self-hosted arithmetic seam. After the VKF-owned
lexer/parser/typed/MIR/validator path was connected, the I128 compiler reached
only the expected unknown I129 private component. GREEN verification with the
fresh isolated I129 compiler:

- nested addition, multiply precedence, and mixed subtraction: 3/3 passed in
  18.91 s;
- source graph and full dependent tagged lexer/parser/typed-IR/Machine-IR
  ownership chain: 28/28 passed in 32.76 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 21.38 s;
- subtraction executable: exit 0, stdout `33`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

This bounded tracer covers a prior numeric binding and one additive chain with
subtraction. Arbitrary expression length, parentheses, unary operations,
division and remaining binary operations, expression-valued bindings, broad
grammar/type lowering, the compiler fixed point, stdlib ownership, and
toolchain-free rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129. I129 commits are `51c8dac6`, `16843c51`, then this evidence commit.
Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- canonical `lexer.vkf`:
  `CC8F82FC419EC196334C364F8CF36B2DD0D90C716A41FADCE37A9531BC31542D`
- canonical `parser.vkf`:
  `BC1CBDBAD2ADC513E093D75AF617FEF5AB2BA761DF0A16D65B6375170A5370E3`
- canonical `typed_ir.vkf`:
  `E35EE0DEEB029D328E42889009542342C4969843356157EB2535B586A3E3C2F0`
- canonical `machine_ir.vkf`:
  `8272A2AF904E7E794D180BD6A902BBD344381774FB7850460DDB144CB722B086`
- canonical `machine_ir_validation.vkf`:
  `76E793C7ABEB0C38E354775BFFF1C6FFD431288EACA1853E97C995949F1DEF33`
- bootstrap bundle identity:
  `6D7331BF2704981F5C7F9E2A079A812E2035AE790B424C71F3D58D60CCDC1304`
- bootstrap manifest file:
  `AE8CA764A18E0E35E60C1D98EC28DEDB74D92144898D71E79E556D2BD81C37B4`
- private Stage bridge source:
  `BB71B56F41EA0B25DD89901816E86530198CFB6E28C4B7869FBBB99724640061`
- arithmetic acceptance test:
  `D4382F1015A7F11FC4D27E0AF9D8184012C2DCA458C617735851659D160604D5`
- isolated I129 `vkf-strict.exe`:
  `F4C6B353038DF6DC6B820D8A5B4D234A168691962BB7A23D6E5A50502D5C914F`

## Acceptance-gate impact

The executable Stage-1 tracer now validates and encodes an additional existing
arithmetic operation instead of limiting mixed chains to addition and
multiplication. Against release gates, 0.5 is estimated at **60.5% total**,
**+0.8 percentage points** from I128's 59.7%.
