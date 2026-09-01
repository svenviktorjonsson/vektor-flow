# 050-I102 linked token-stream tracer evidence

## Scope

- Base: `a016387`
- RED: `98a9eac`
- Implementation: `60d7691`
- Branch: `codex/0.5/050-i102-linked-token-stream`

I102 extends the linked production lexer from one token to two consecutive
identifier tokens. VKF-owned code skips spaces, tabs, and newlines with
`StringCursor`, scans each identifier, and returns both token records. The
executable harness agrees with the canonical lexer for kind, spelling, line,
and column across a newline and tab.

This is a compiler-internal tracer. It does not add a public VKF API, syntax,
diagnostic, opcode, Machine-IR schema, or ABI.

## TDD evidence

The RED test failed at direct call resolution because the production lexer did
not define the pair producer. After adding the smallest whitespace and
identifier cursor walks, the same test passed without backend changes.

Final fresh-tool evidence:

- linked two-token differential: passed;
- I98-I102 cursor, source graph, scalar boundary, linked producer, and linked
  token stream suite: 10/10 passed in 1.41 s;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 488 ms;
- emitted lexer artifact execution: exit 0 with no output.

All executable tests used fresh binaries from `build/050-i102/bin` and hidden
child processes.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102. I102 commits are `98a9eac`, `60d7691`, then this evidence commit. Do
not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `9886942162A814EA121396E666826638D0ABF9D7F1659DB908D8987AC4F01156`
- bootstrap manifest:
  `E0631A2C393A4FC03B3725046041721A4CEC21C04BE58AE2C928F9C040A0D050`
- linked token-stream acceptance test:
  `0E8CDBFB3BE74E094866449C4285CA1C8E9C340B4E92A81960A7E29C8BCE41AD`
- fresh `vkf-strict.exe`:
  `469553007DD6E58ACA4A50188C67DDEABAE6B1FE616F7D77B5641B9DEF49010A`
- fresh canonical lexer oracle:
  `AA78FE3377D06BC5238F820848A2C4449568E1E137C7BB8C8983B62970E37346`
- directly emitted lexer artifact:
  `45CBA2A88296FF9EE49EBA570994388B96615005C6C0C42FDC718D158C730B9D`

## Acceptance-gate impact

The linked Stage-1 tracer now demonstrates cursor continuation between tokens,
including layout skipping and source-position preservation. The next packet
should add the existing numeric token shape to the same linked stream and
differentially cover `alpha 123 beta45 6.7` before punctuation and structural
tokens are attempted.
