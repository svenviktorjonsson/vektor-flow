# 050-I103 linked number-stream tracer evidence

## Scope

- Base: `9f25499`
- RED: `2bfc14a`
- Implementation: `298c1c5`
- Branch: `codex/0.5/050-i103-linked-number-stream`

I103 executes the production lexer fixture `alpha 123 beta45 6.7` through the
linked VKF module. VKF-owned cursor walks now emit identifier and NUMBER tokens,
including decimal accumulation, while preserving the canonical source line and
column. The oracle compares NUMBER values numerically, so equivalent IEEE
values are not rejected because one renderer chooses `6.7000000000000002` and
JSON chooses `6.7`.

The numeric scanner is a compiler-internal bootstrap tracer. No public VKF API,
syntax, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD evidence

The RED test failed because the linked lexer had no numeric-stream producer.
The first GREEN candidate matched all fields except decimal display spelling;
the test was then corrected to compare numeric values rather than formatted
text. Exact kind and source positions remain required.

Final fresh-tool evidence:

- I98-I103 cursor, source graph, scalar boundary, linked identifier, layout,
  and numeric stream suite: 11/11 passed in 2.09 s;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 778 ms;
- emitted lexer artifact execution: exit 0 with no output.

All executable tests used fresh binaries from `build/050-i103/bin` and hidden
child processes.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103. I103 commits are `2bfc14a`, `298c1c5`, then this evidence
commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `614AA3E8423E62AFFBC49B2BB1046E2DE1BA6649B5D8F25236060F963C262D7E`
- bootstrap manifest:
  `7AFB20C6106E5657938CB3EE16954FB34D0E02AA31CFEFF54D381387541D3744`
- linked numeric-stream acceptance test:
  `01E289ACD27A73599BE37F87CE0975066171A753C1600AE83F15D98736977F65`
- fresh `vkf-strict.exe`:
  `A6581312ABA3640ED38C098BB7EE0811016A40F6BEA51D5F24ADBDE885C1386D`
- fresh canonical lexer oracle:
  `1A839C087EC9D97EDCDE2A48F521CA32E33BD6C35BE990B8393B63D68D04DB37`
- directly emitted lexer artifact:
  `FAF2EFDFE419D45ADB444D52BA25EA7C167EF7601339DE6A259A51E2ADC87360`

## Acceptance-gate impact

The linked Stage-1 lexer now owns the complete identifier/decimal-number parity
fixture already recorded in its source. The next packet should add one
punctuation/operator tracer with exact source positions, then reuse those
pieces in a bounded token-stream result that includes NEWLINE and EOF.
