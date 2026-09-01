# 050-I98 StringCursor lexer evidence

## Scope

- Base: `6987d116db9d862e2dbc82a45556f8cc95f51f87`
- RED: `da2f039`
- Implementation: `7a4cff6`
- Public-contract record: `6835965`
- Branch: `codex/0.5/050-i98-string-cursor`

Viktor selected API A on 2026-09-01. The exact public surface is
`StringCursor(source)`, `cursor.position`, `cursor.eof`, `cursor.peek()`,
`cursor.advance()`, and `cursor.slice(start, end)`. Positions and slice bounds
are UTF-8 byte offsets, while peek and advance operate on complete Unicode
scalars. The implementation adds no public free-function spellings. Private
runtime operations remain underscore-prefixed compiler seams.

The self-hosted lexer now declares the CamelCase nominal cursor and calls its
methods. The native lexer oracle uses the same position and EOF state. Scalar
decoding and width calculation remain centralized in the string primitive
layer, so advance cannot split a multibyte scalar. Existing line, column, and
invalid-UTF-8 diagnostics are preserved.

## TDD evidence

The RED source-contract test first failed because `StringCursor` was absent.
After the nominal source shape was added, a separate frontend RED showed
`cursor.peek()` did not lower to the private cursor operation. The narrow
method lowering now applies only when the receiver has type `StringCursor` and
only for the three approved methods.

Final focused evidence with freshly built native tools:

- source graph, canonical digests, public source shape, method lowering,
  multibyte lexing/slicing, and invalid UTF-8 diagnostic: 6/6 passed in
  691.99 ms;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 341 ms;
- emitted lexer artifact execution: exit 0 with no output;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed.

An old compiler copied from `build/050-b00` reproduced a block-layout failure.
A fresh I98 compiler compiled the same lexer successfully, proving that result
was stale-tool evidence rather than an I98 product blocker.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98. I98 commits are
`da2f039`, `7a4cff6`, `6835965`, then this evidence commit. Do not merge or
reset the original dirty I84 worktree.

## Contract hashes

- `vkf_ast_to_ir_smoke.cpp`:
  `5893DBCD5B8C0AB1E7DDAC832CBC4C686B0BEA46661733D2273C3E156884E65F`
- `vkf_lexer_cursor_smoke.cpp`:
  `7903A47293ED888781D55F682C2C53997F539432DBBED1513D26A404A08ADD0B`
- `vkf_string_primitives.hpp`:
  `206B2290D88D42D0C4CA557E364B6E6FBC003F21DB31D3E44EC44797B5A8B282`
- `lexer.vkf`:
  `A3123387CC9E706A98E493C2C315616674BCDC490B88E1DA6D17BE82454B22BD`
- bootstrap manifest:
  `0C5B1F400F32885EDD044DDB9FE2D36FF2D41949FA3CB135211289E8291A10B2`
- focused acceptance test:
  `8C9CAC9027F11EB6B34316FCB95AB57C75C6552B55D725B61984C1E933D78ACE`
- public contract record:
  `0619B1D17DB7B92A4ADFA7F01EAC8E03556D53C04ED7E74ECAB19EBBCE694697`
- fresh `vkf-strict.exe`:
  `B20A78DBD829246F664CDBE51D2EA44B1C5DDDCA8EDDB8A21D86C96B312B23D0`
- fresh AST-to-IR oracle:
  `1704A52B8ABECC91D96447E4AA4A8FE14E109D0C22367A02AAFBC0867E80435E`
- fresh lexer oracle:
  `966DC7A5652CB36B5A6F721FE9D151FD86067CC9274790FA8F60C227C5C17364`
- emitted lexer artifact:
  `94EED6E075AAD673393659226212270981908FB238097A5DC10558D80F1A7B2E`

## Acceptance-gate impact

The approved scalar-safe cursor contract is now represented consistently in
the public architecture record, self-hosted lexer source, frontend lowering,
native lexer oracle, and executable Stage-1 lexer artifact. This clears the
cursor dependency without broadening general member-call semantics.

I98 does not yet make the VKF-authored lexer the producer of the token stream
used to rebuild Stage 2. The next packet must execute one real scan path through
the compiled `StringCursor` methods and compare its tokens and diagnostics with
the canonical lexer oracle before connecting that producer to the bootstrap
pipeline.
