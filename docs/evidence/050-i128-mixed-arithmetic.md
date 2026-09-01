# 050-I128 mixed-arithmetic encoding evidence

## Scope

- Base: `bc67ddac`
- RED: `26eb182a`
- GREEN: `c8e3264a`
- Branch: `codex/0.5/050-i128-mixed-arithmetic`

I128 extends the executable Stage-1 tracer across two existing arithmetic
operations and their existing precedence:

```vkf
value: 31
value + 1 * 2
```

The self-hosted lexer retains `*` in the statement tape, the bounded parser
recognizes the existing multiply-before-add shape, typed IR retains its three
integer operands, and Machine IR emits `push 31`, `push 1`, `push 2`,
`multiply`, `add`, `return`. Self-hosted validation proves maximum stack depth
three before the private Stage bridge passes the closed zero-parameter v4
module to the existing x64 encoder. The artifact prints `33`.

The tracer adds no public syntax, API, diagnostic, opcode, Machine-IR schema,
or ABI.

## TDD and regression evidence

RED reached the intended unknown private component after the VKF-owned path
compiled. The first fresh-compiler GREEN run exposed an acceptance-fixture
projection error: the fixture printed the multiply instruction's unused value
instead of the preceding push value. Correcting only that observation made the
exact emitted leaf contract agree with the bridge. Verification with the
isolated I128 compiler:

- nested-addition and mixed-precedence end-to-end encoding: 2/2 passed in
  13.29 s;
- source graph and full dependent tagged lexer/parser/typed-IR/Machine-IR
  ownership chain: 27/27 passed in 41.45 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 30.71 s;
- mixed executable: exit 0, stdout `33`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

This bounded tracer covers a prior numeric binding and one mixed
multiply-before-add expression. Arbitrary expression length, parentheses,
unary operations, additional binary operations, expression-valued bindings,
broad grammar/type lowering, the compiler fixed point, stdlib ownership, and
toolchain-free rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128.
I128 commits are `26eb182a`, `c8e3264a`, then this evidence commit. Do not
merge or reset the original dirty I84 worktree.

## Contract hashes

- canonical `lexer.vkf`:
  `1F3E5DBE39F7C267C25D209357F24955EF9D53054C5F8060A113164725F6AB8A`
- canonical `parser.vkf`:
  `D0648F36016BB8A03776E21CE1EF96AA1F773745731CA41CFEFE4393694D969F`
- canonical `typed_ir.vkf`:
  `845856BE9A2ECAFCC0F876F8026F52EA1FD6DC7A96D31E59F79AF32F441BB721`
- canonical `machine_ir.vkf`:
  `FE68F6DE95B6100B789893EC34A8BD98C06A2E1CD055FDE26027D1E9D1EF47FB`
- canonical `machine_ir_validation.vkf`:
  `706BEA236366FDCFB8ABB9445E883C89F6FFA8B41D17FEFCA771196A62F8A866`
- bootstrap bundle identity:
  `6DD390F7A648E72FD14D198425C6011656E96A8C59D8FFDD2C19AF1FF5C9E9FE`
- bootstrap manifest file:
  `DB35826C7A4632BFB8B9E951C596EC976E29925B3919292AD10846418CD13C23`
- private Stage bridge source:
  `E4DC802843809272499C0333DD0EE0F9ECA243438E9EC907C9304B84C14DC97C`
- mixed-arithmetic acceptance test:
  `3FC2CDCF2AC6F95781A79EC26CE5786203B976A09F4BFAC21B7294BF4858AC62`
- isolated I128 `vkf-strict.exe`:
  `F1A0B8F41AA4D49BCD4E940419068B307E0D3C69DAE8A6F2B7954742A3E2B257`

## Acceptance-gate impact

The executable Stage-1 tracer now preserves existing mixed arithmetic
precedence through native encoding rather than stopping at repeated addition.
Against release gates, 0.5 is estimated at **59.7% total**, **+1.0 percentage
point** from I127's 58.7%.
