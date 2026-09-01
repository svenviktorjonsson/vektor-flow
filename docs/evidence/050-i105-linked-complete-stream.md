# 050-I105 linked complete-stream tracer evidence

## Scope

- Base: `27a49d8`
- RED: `5291c10`
- Implementation: `f58eb12`
- Branch: `codex/0.5/050-i105-linked-complete-stream`

I105 completes the bounded `alpha+beta` token stream in the linked production
lexer. VKF-owned code emits IDENT, PLUS, IDENT, synthetic NEWLINE, and EOF with
the same values and source locations as the canonical native lexer.

This compiler-internal tracer adds no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED test failed because the linked lexer did not expose a complete stream.
The implementation composes the already accepted identifier and plus cursor
walks, proves the cursor is at EOF, and emits the two terminal tokens at that
cursor location.

Final evidence:

- I98-I105 cursor, source graph, scalar boundary, linked identifier, layout,
  number, plus, and complete stream suite: 13/13 passed in 2.79 s;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 852 ms;
- emitted lexer artifact execution: exit 0 with no output.

Native compiler sources are unchanged from I104, so I105 reused the immediately
preceding fresh I104 compiler/oracle binaries by verified SHA-256 rather than
performing a redundant rebuild. All child processes remained hidden.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105. I105 commits are `5291c10`, `f58eb12`, then
this evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `BCAD005F0211E761B8BC1620FC53D8DDBB8A74D0F4E466A87017BC8040AF76C3`
- bootstrap manifest:
  `406BC7038A5D9FACEBB648D10F6AF0A20CC71556C6631A375BE2DADC90BCA946`
- complete-stream acceptance test:
  `E39846C9D7CF3E80C41F7323C1B86290691295A64C2B2261DF8B666F82918CB6`
- hash-gated fresh I104 `vkf-strict.exe`:
  `64E0252896A3BCE87BCED4E96F1CBA9AB9E178D0397056DA07DCB7EE77FA2E42`
- hash-gated fresh I104 canonical lexer oracle:
  `D0A21EE4306C7EC12B3F420CFFAE8DC986720DE10070AB852B1849E12C5690AC`
- directly emitted I105 lexer artifact:
  `4A2B746ECD98122127948C34F87691D05A11E4E65514B2412EA74B0A308383B6`

## Acceptance-gate impact

The Stage-1 path now has a linked, executable, canonical complete token stream
rather than isolated token fragments. The next dependency-ordered packet should
replace the bounded named result with the compiler's existing token-stream
container shape, keeping the same five-token oracle and adding no new public
surface.
