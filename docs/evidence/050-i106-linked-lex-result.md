# 050-I106 linked LexResult evidence

## Scope

- Base: `8717341`
- RED: `d9c6bce`
- Implementation: `813d601`
- Branch: `codex/0.5/050-i106-linked-lex-result`

I106 replaces the bounded stream's named token fields with the existing lexer
result shape: a homogeneous `tokens` vector and an empty `errors` vector. The
five token records remain directly indexable and match the canonical lexer for
kind, value, line, and column.

This compiler-internal tracer adds no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED test failed because the production linked lexer had no result-container
producer. The implementation wraps the already accepted complete stream in the
source's existing `LexResult` structure without backend changes.

Final evidence:

- I98-I106 cursor, source graph, scalar boundary, linked token fragments,
  complete stream, and LexResult suite: 14/14 passed in 3.96 s;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 1012 ms;
- emitted lexer artifact execution: exit 0 with no output.

Native sources remain identical to I104; tests reused its fresh compiler/oracle
binaries by verified SHA-256. All child processes remained hidden.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106. I106 commits are `d9c6bce`,
`813d601`, then this evidence commit. Do not merge or reset the original dirty
I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `133B875ACDE47CE14E349033A49DE5B30FA793B7AE13DA44B70B295335D2A322`
- bootstrap manifest:
  `C89C1662B601B2FBB03390D32783CA179DFA48930FA93B7C4470E6507A0AD37B`
- linked LexResult acceptance test:
  `643BD57862880E7A905BA4BD868A82119A0FDC37C6C9DBC6D63146A4430031CB`
- hash-gated fresh I104 `vkf-strict.exe`:
  `64E0252896A3BCE87BCED4E96F1CBA9AB9E178D0397056DA07DCB7EE77FA2E42`
- hash-gated fresh I104 canonical lexer oracle:
  `D0A21EE4306C7EC12B3F420CFFAE8DC986720DE10070AB852B1849E12C5690AC`
- directly emitted I106 lexer artifact:
  `89D046DED169267C0BC56EF4CAF62A5D1110E77F60E1ACC4D3B149D26385D7F1`

## Acceptance-gate impact

The Stage-1 linked lexer now produces the compiler's normal result container,
not only test-specific token records. The next packet should make this bounded
LexResult feed the self-hosted parser's existing token cursor for one minimal
expression, establishing the lexer-to-parser executable handoff.
