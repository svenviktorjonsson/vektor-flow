# 050-I117 dynamic statement-storage evidence

## Scope

- Base: `cfd79f8`
- RED: `fe90822`
- GREEN: `a1c994a`
- Branch: `codex/0.5/050-i117-dynamic-statement-storage`

I117 removes the parser's three-statement representation ceiling without
requiring a heterogeneous dynamic backend layout. It adds an internal
homogeneous numeric statement tape. Each eight-number row retains identifier
byte bounds, operator code, number value, and source locations; one owned
source string supplies identifier text when a statement node is demanded.

This is a compiler-internal representation seam. It changes no public VKF
syntax, API, diagnostic, opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED probe required storage to grow from one statement through 128 and
failed because the imported parser exposed no such direct calls. The GREEN
probe appends 128 rows in source order, reconstructs the first and last nodes,
and proves UTF-8 byte slicing does not split the two-byte `å` scalar.

The hidden executable produced:

```text
128
1024
å
1
beta
128
2
6
```

Final evidence using the fresh I115 ownership-correct compiler:

- source graph, aggregate ownership, and the full dependent tagged
  lexer/parser chain: 12/12 passed in 37.01 s;
- direct strict compile of `parser.vkf`: exit 0 in 3634 ms;
- direct execution of the emitted parser artifact: exit 0.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The dynamic tape now supports a statement count beyond the fixed one/two/three
result aliases and reconstructs a canonical typed expression node on demand.
The lexer-to-tape EOF driver and demand-driven ModuleNode materialization remain
separate slices. The public ModuleNode shape is unchanged.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117. I117 commits are
`fe90822`, `a1c994a`, then this evidence commit. Do not merge or reset the
original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes where stated.

- canonical `parser.vkf`:
  `C6185A8A2B629F7D464E80C8A8436224E7364880F068A1017B7941E01A90304D`
- bootstrap bundle identity:
  `C9BE61628C9E94BB8C6305807BCB0709BC11EEAAE678D62B5E4624CFAA0043A9`
- bootstrap manifest file:
  `F9CEE5DCF660101F1BE958B49709E4C05DDC3E8E4331775046FD7E4823936FA7`
- dynamic-storage acceptance test:
  `EDC008C08EFC0D8B14BD8FA46B89BD91BD344C27638E296B014778A6671A3D40`
- fresh I115 `vkf-strict.exe`:
  `19A8697696D4E377082634AE86681D610199C188825A9043028EB3073CBB7A3D`
- directly emitted I117 parser artifact:
  `22183DB4AFB301C6460DD70B8A5243637207C16308E19F7AB890EAE1C9C8066E`

## Acceptance-gate impact

The Stage-1 frontend now has an ownership-safe dynamic representation for an
arbitrary homogeneous sequence of its current executable expression nodes. It
no longer requires another fixed result alias for each statement count. Actual
EOF-driven ingestion, broader statement kinds, the full parser/frontend, fixed
point, stdlib ownership, and toolchain-free rebuild remain open.
