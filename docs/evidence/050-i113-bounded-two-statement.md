# 050-I113 bounded two-statement evidence

## Scope

- Base: `cb427a4`
- RED: `855dde3`
- Implementation: `eb0275e`
- Branch: `codex/0.5/050-i113-bounded-two-statement`

I113 extends the executable self-hosting tracer from one expression statement to
two newline-separated statements. The linked lexer emits fixed tagged tokens for
`alpha+42\nbeta+7`, the flattened cursor traverses all nine bounded positions,
and the parser returns the two existing `BinaryOpNode` values in one `ModuleNode`
and `ParseResult`.

This compiler-internal tracer changes no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

Against I112, the RED tracer failed before artifact output because neither the
bounded two-expression stream nor two-statement parser operation existed. The
final hidden execution produced:

```text
module
2
alpha
42
beta
7
0
8
true
```

Final evidence using the fresh hash-gated I108 compiler:

- source graph, I107 handoff, I108 lexical scope, I109 tagged values, I110
  cursor advance, I111 expression, I112 parse result, and I113 two-statement
  suite: 9/9 passed in 7.36 s;
- direct strict compile and execution of `lexer.vkf`: exit 0, compile 845 ms;
- direct strict compile and execution of `parser.vkf`: exit 0, compile 2533 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The tracer is deliberately fixed to two binary-expression statements and nine
cursor positions. It proves ordered statement accumulation and EOF traversal
without relying on unsupported dynamic aggregate indexing. A general statement
loop, expression precedence, recovery, and unbounded token storage remain
separate backend/frontend slices.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113. I113 commits are `855dde3`, `eb0275e`, then this
evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `BCDF52A1B80A42AB283DA47CF5820AC8ADB7619DB385FF250089A267B383F4F0`
- canonical `parser.vkf`:
  `40418A5023C649CB5BEA2B9A96CFCB2977E7EA9E68E0077F88FA54E65294C09E`
- bootstrap bundle identity:
  `63FF2F41D7DEE4DCCCF05DD549DD468EB8A49E864A96AB6195787CDD69C34A19`
- bootstrap manifest file:
  `315E18CD36EB7197774910BDCBD63EA326F908A8CFF93D20D2A3571DBBCE28EB`
- I113 acceptance test:
  `2E74F5E7FA9915A1E3C344CDA256AF31E2238C70AA937EDFEBCFC5B737A89192`
- hash-gated fresh I108 `vkf-strict.exe`:
  `EDF8ECED8C5854FB2F5E14D1BF8CBB1BDD4E044169A9C6DFF2F1EF5252F8CEC8`
- directly emitted I113 lexer artifact:
  `6FE063BFC3F509A171F3A789C478787785EE01672F1E91EBF7DE412B1C5F22C7`
- directly emitted I113 parser artifact:
  `A39F4095082C684769690C2CA2E4DC1CCB15CE354F7BD38FF575497FCF7AD414`

## Acceptance-gate impact

The Stage-1 frontend now preserves source order while accumulating more than one
executable statement into a module and reaches EOF with zero diagnostics. This
closes the bounded two-statement tracer, but not general statement iteration,
the full parser/frontend, fixed point, stdlib ownership, or toolchain-free
rebuild.
