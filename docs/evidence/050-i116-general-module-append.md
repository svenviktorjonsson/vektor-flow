# 050-I116 general module-append evidence

## Scope

- Base: `4c85a05`
- General-append RED: `ad5f75e`
- General-append GREEN: `ac93ab9`
- Three-statement RED: `ab29d86`
- Three-statement GREEN: `35df668`
- Branch: `codex/0.5/050-i116-general-module-append`

I116 replaces the parser's safe fixed projection with true owned aggregate
append and then extends the same operation from two bounded statements to three.
The module keeps source order, expands its span through line 3, preserves the
diagnostic vector, and observes EOF after the third bounded cursor stream.

This compiler-internal tracer changes no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The first RED asserted that parser accumulation must use
`result.module.body & [expression]`; I115 still used the one-slot projection.
After the owned append passed, the second RED failed because the typed
two-to-three append operation did not exist.

The final three-statement hidden execution produced:

```text
3
alpha
beta
gamma
3
7
0
4
true
```

Final evidence using the fresh I115 ownership-correct compiler:

- ownership, source graph, and full dependent lexer/parser chain: 13/13 passed
  in 17.16 s;
- direct strict compile and execution of `lexer.vkf`: exit 0, compile 1136 ms;
- direct strict compile and execution of `parser.vkf`: exit 0, compile 2140 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The module body now grows through the real aggregate append operator, but result
types remain statically bounded at one, two, and three statements. This is the
largest count expressible through the current fixed result aliases without a
dynamic heterogeneous AST-vector layout or type-parameterized fixed vector.
General EOF-driven iteration remains a separate representation/backend slice.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116. I116 commits are
`ad5f75e`, `ac93ab9`, `ab29d86`, `35df668`, then this evidence commit. Do not
merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `BCDF52A1B80A42AB283DA47CF5820AC8ADB7619DB385FF250089A267B383F4F0`
- canonical `parser.vkf`:
  `A97C39EAE76EBC60993FB97D56401DF409D67AD51AB1D0F770C06D812B3347F5`
- bootstrap bundle identity:
  `B7E8352F405DC74CB9B1F32960587880F9FE25F8E145E9044204BA94ABBB35C8`
- bootstrap manifest file:
  `6DA68FAD8CF76516BE54EAB29F54936E7A9381EF324E8CD218613B9DA8D6ED2E`
- general-append acceptance test:
  `1E7D6B0EF738E9F290F46EBBE686448FBE0F0879B93EC0B277D2F584C0F73257`
- three-statement acceptance test:
  `6E4C823E066137E8D2CC8F3726DFA2A34B031A9C3456442DA01868629A649E92`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I116 lexer artifact:
  `4C1D055887D86FD11957D8154A1275539E540A9DFD92B33253D289672E0E6BB9`
- directly emitted I116 parser artifact:
  `122341DA8B9CAABD508E7AD705EB954F3DB41447E6BE838697DF82DCA2C1D6ED`

## Acceptance-gate impact

The Stage-1 frontend now uses the ownership-correct general append operator for
ordered module accumulation and proves it beyond the original two-statement
special case. Dynamic statement storage/EOF iteration, the full parser/frontend,
fixed point, stdlib ownership, and toolchain-free rebuild remain open.
