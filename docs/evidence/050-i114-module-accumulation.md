# 050-I114 bounded module-accumulation evidence

## Scope

- Base: `a6c894a`
- RED: `aae31b0`
- Implementation: `34d50c8`
- Branch: `codex/0.5/050-i114-module-accumulation`

I114 separates ordered module accumulation from the fixed two-statement parser
entry point. A typed single-statement result can now be extended by one bounded
binary statement while preserving its first statement, source span, diagnostic
vector, and final EOF cursor.

This compiler-internal tracer changes no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

Against I113, the RED tracer failed before artifact output because
`append_tagged_binary_statement` did not exist. The final hidden execution
produced:

```text
2
alpha
beta
1
1
2
6
0
8
true
```

Final evidence using the fresh hash-gated I108 compiler:

- source graph, I107 handoff, I108 lexical scope, I109 tagged values, I110
  cursor advance, I111 expression, I112 parse result, I113 two-statement, and
  I114 module-accumulation suite: 10/10 passed in 7.09 s;
- direct strict compile and execution of `lexer.vkf`: exit 0, compile 653 ms;
- direct strict compile and execution of `parser.vkf`: exit 0, compile 3076 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The append transition is typed from one statement to two and uses a fixed
projection for the retained first node. An exploratory general
`result.module.body & [expression]` implementation compiled but terminated with
Windows status `0xC0000374`, exposing aggregate-concatenation ownership of nested
strings as the next backend prerequisite. I114 does not weaken ownership or hide
that fault. Arbitrary statement counts remain open until that prerequisite has
its own regression test and fix.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114. I114 commits are `aae31b0`, `34d50c8`, then
this evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `BCDF52A1B80A42AB283DA47CF5820AC8ADB7619DB385FF250089A267B383F4F0`
- canonical `parser.vkf`:
  `D679C12DC835ECEC4ED6B1D030ABB5AFB0431BD88037B66CADAB64D5031D61FC`
- bootstrap bundle identity:
  `766859584BCBFB2E398380B81A39384A0155329972ABE0A78F75A74FD900FB64`
- bootstrap manifest file:
  `C2C4AE61D5DFF8F85B229224F86859294F27EA6BA06EE973E372B87916788C34`
- I114 acceptance test:
  `90EBB41841A909CC3C003C08E725C98E97313A40C2A6F65F8F758FD13A6119D4`
- hash-gated fresh I108 `vkf-strict.exe`:
  `EDF8ECED8C5854FB2F5E14D1BF8CBB1BDD4E044169A9C6DFF2F1EF5252F8CEC8`
- directly emitted I114 lexer artifact:
  `54F5E027640C892FCBD0A73B91D0ACFFBF84DAFC188E68448E400DFFCD5D9ED4`
- directly emitted I114 parser artifact:
  `CAC6F647EFAE64BBFFBBA8B17698E284E38689F9CA396C40E52DA0BE9D98F993`

## Acceptance-gate impact

The Stage-1 frontend now has a separate ordered module-accumulation operation
instead of constructing both statements in one parser function. This closes the
bounded one-to-two accumulation slice and identifies nested-string aggregate
ownership as the exact prerequisite for general iteration. General statement
iteration, the full parser/frontend, fixed point, stdlib ownership, and
toolchain-free rebuild remain open.
