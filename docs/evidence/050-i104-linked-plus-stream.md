# 050-I104 linked plus-stream tracer evidence

## Scope

- Base: `88b2370`
- RED: `ce7e6fc`
- Implementation: `e98277a`
- Branch: `codex/0.5/050-i104-linked-plus-stream`

I104 executes `alpha+beta` through the linked production lexer. VKF-owned code
emits IDENT, PLUS, IDENT with canonical values, line, and column. The operator
cursor is handed directly to the next identifier scan, demonstrating token
continuation without layout between adjacent tokens.

This compiler-internal tracer adds no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED test failed because the linked lexer exposed no plus-stream producer.
The smallest production implementation adds a checked PLUS token constructor
and composes it with the existing identifier cursor walks.

Final fresh-tool evidence:

- I98-I104 cursor, source graph, scalar boundary, linked identifier, layout,
  number, and plus stream suite: 12/12 passed in 2.41 s;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 812 ms;
- emitted lexer artifact execution: exit 0 with no output.

All executable tests used fresh binaries from `build/050-i104/bin` and hidden
child processes.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104. I104 commits are `ce7e6fc`, `e98277a`, then this
evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `6920B662B1A960685C32BCD0E9A1740B2CE32DE4E52C38D69AB3785354D4017C`
- bootstrap manifest:
  `F1C6950FF92EF4A639A22197331831E00716B59213D69ECCFF5E2F284CF58B54`
- linked plus-stream acceptance test:
  `959969C94EF35E46F4CFCEE010E96ACA69ADA6C872DD9A448503E66D0C186D8D`
- fresh `vkf-strict.exe`:
  `64E0252896A3BCE87BCED4E96F1CBA9AB9E178D0397056DA07DCB7EE77FA2E42`
- fresh canonical lexer oracle:
  `D0A21EE4306C7EC12B3F420CFFAE8DC986720DE10070AB852B1849E12C5690AC`
- directly emitted lexer artifact:
  `6BC6F79402A3B98DF8A02022C40E054D6B623418F13EDE4B26DA0BDA4F0068FD`

## Acceptance-gate impact

The linked Stage-1 lexer now covers identifier, decimal number, layout, and one
operator class in executable machine code. The next packet should assemble a
bounded result containing those token classes plus synthetic NEWLINE and EOF,
so the tracer crosses from token fragments to a complete canonical stream.
