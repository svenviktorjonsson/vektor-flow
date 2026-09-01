# 050-I123 dynamic binding handoff evidence

## Scope

- Base: `eeb0eaf`
- RED: `f153e9e`
- GREEN: `4d4b502`
- Branch: `codex/0.5/050-i123-dynamic-binding-handoff`

I123 extends the count-independent frontend tracer with existing VKF numeric
binding syntax. The dynamic lexer recognizes `:`, the parser records binding
and `+` statement codes in its homogeneous eight-number rows, and typed IR
materializes a typed `store_binding`. A later identifier expression resolves
against that binding, changing its load and result types from `any` to `int`.

This reuses established binding, literal inference, and unknown-symbol
semantics. It changes no public VKF syntax, API, diagnostic, opcode,
Machine-IR schema, or ABI.

## TDD evidence

The RED probe failed because the dynamic tracer accepted only `+` and had no
typed binding/symbol handoff. The GREEN probe compiled and executed:

```vkf
value: 31
value + 1
```

Its observable result was:

```text
9
2
2
1
store_binding
value
const
31
int
value
int
1
int
int
```

The first four values prove nine tokens through EOF, two parser rows, binding
statement code 2, and binary statement code 1.

Final evidence using the fresh I115 ownership-correct compiler:

- source graph, ownership, and full dependent tagged lexer/parser/typed-IR
  chain: 16/16 passed in 61.93 s;
- direct strict compile/execution of `lexer.vkf`: exit 0 in 973 ms;
- direct strict compile/execution of `parser.vkf`: exit 0 in 2593 ms;
- direct strict compile/execution of `typed_ir.vkf`: exit 0 in 1967 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The expression is now closed and typed, but Machine IR still lowers its
identifier as a function parameter. The next slice can substitute the known
binding constant, validate the closed stack program, and only then encode it.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123. I123 commits are `f153e9e`, `4d4b502`, then
this evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `lexer.vkf`:
  `2D5ED54CB018C7254659644DFA4BFBFE313653F7D08242971C6A651697B28546`
- canonical `parser.vkf`:
  `E5B3297D9E1B038C05A36A2EF2740BD63438AE124E9C326FEC1938F17CB01CFD`
- canonical `typed_ir.vkf`:
  `8892D77B68900BB84FD4C1E297853D2C9EB8394A56F3D420316DB7543B72FBB0`
- bootstrap bundle identity:
  `324EA8F7A0126C552CFA838C4FC5E18201CF4F8C285722CFB698591271E11366`
- bootstrap manifest file:
  `2E65BDC1EA0FAE538ED07E8762BBCF7C6C1F0FF5338E0C0AFFAEB34792655AC8`
- dynamic-binding acceptance test:
  `C10F99784E493985975964A5F67CCFEE90CA0334C88F605C5C910064D78D2BED`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I123 lexer artifact:
  `CF3E38AEAFA8936273982540F53B48A360268BAC30361A1B2782D55E00C33C9C`
- directly emitted I123 parser artifact:
  `EC493C1525FF7B26A9B0C1B8721839E5B4D4A60BFEB8921EDD3C2D418F3AB39E`
- directly emitted I123 typed-IR artifact:
  `CDF928F751EA50BFA0CB254B55E62A5526D4F1CF1195610A1F83FFE90C640182`

## Acceptance-gate impact

The count-independent Stage-1 frontend now covers both numeric binding and a
later symbol-resolved expression through typed IR. Closed Machine-IR lowering/
encoding, broader grammar/type lowering, the compiler fixed point, stdlib
ownership, and toolchain-free rebuild remain open.
