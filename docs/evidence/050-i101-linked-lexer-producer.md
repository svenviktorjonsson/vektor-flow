# 050-I101 linked self-hosted lexer producer evidence

## Scope

- Base: `8f2ba9ed3e54376a3f0be4d35191a722dec03104`
- RED: `d4ed0a2`
- Implementation: `8d4c258`
- Branch: `codex/0.5/050-i101-linked-lexer-producer`

I101 links the exact `compiler/self_hosted/lexer.vkf` source as a module in an
executable producer. The VKF-owned `identifier_token` path seeks with
`StringCursor`, scans through `peek()` and `advance()`, obtains spelling through
`slice(start, end)`, and emits a `Token`. Its kind, spelling, line, and column
agree with the canonical native lexer for the same source.

Linked module symbol rewriting now preserves nominal type annotations. The
frontend recognizes a CamelCase constructor after an internal module prefix,
resolves the nominal record representation for field typing, and lowers only
the three approved `StringCursor` methods to their module-local private
backing functions. No public API, syntax, diagnostic, opcode, Machine-IR
schema, or ABI changed.

## TDD evidence

The RED test failed because the linked module exposed no executable identifier
producer. The first implementation run then exposed two linked-nominal gaps:
module prefixes hid constructor identity, and nominal fields were typed as
`any`. Both are now covered by the linked producer acceptance test.

Final fresh-tool evidence:

- exact linked producer differential: 1/1 passed in 1.66 s;
- source graph, canonical digests, cursor frontend/oracle contracts, executable
  scan, scalar-boundary rejection, and linked producer: 9/9 passed in 1.58 s;
- queue method regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 781 ms;
- emitted lexer artifact execution: exit 0 with no output.

All tests used fresh binaries from `build/050-i101/bin` and hidden child
processes. The linked test copies the production lexer byte-for-byte and checks
the copy hash before compiling its harness.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101.
I101 commits are `d4ed0a2`, `8d4c258`, then this evidence commit. Do not merge
or reset the original dirty I84 worktree.

## Contract hashes

Source hashes below use canonical LF bytes, matching the bootstrap digest gate.

- AST-to-IR frontend:
  `B30BD7508DA7B604281C499812C5F1D8604A98EED5E10A1F945BEC5001A0B24D`
- module linker:
  `3EE6711DB082AF95402E595EFC6397243C0B939EF9D4F1615DBC13990088EF51`
- unchanged `vkf_machine_ir_lowering.hpp`:
  `4231E9D84354081B4F9762EA3B53CEADACE52DB2E1E0E3BA0DC1FB231A8E725F`
- canonical `lexer.vkf`:
  `8706C28A2EDA98D7C12C3DDC7FBEBDE3EB47E5384B22680AD39F9AE86EB4D298`
- linked producer acceptance test:
  `ECC29B5D6C630A5084158F104ED1087C80ADE11E2A8EA27CAF51182E88F339D1`
- fresh `vkf-strict.exe`:
  `4D46DBC47622A294AD813C628FF133D7CDCFE44DD1D2C9F38F553EDBB5B1AD6F`
- fresh canonical lexer oracle:
  `591E1645D240BA1D94DF78BD4A35E4F90678E4544EED65E948FDB3FB73D90FFF`
- directly emitted lexer artifact:
  `2D6DB4F1F27E610F640DB95A8578A5C3FC5D9172E8C0A26EF238349BA1BE4357`

## Acceptance-gate impact

The cursor tracer is no longer a duplicated test fixture: executable machine
code now consumes the production self-hosted lexer module. This is the first
linked VKF-owned token producer on the Stage-1 path and establishes nominal
constructor/method linkage needed by later compiler modules.

The next dependency-ordered packet should extend the same production module
from one identifier token to a small token stream that skips whitespace and
emits consecutive identifiers, differentially checking source positions before
adding numbers, punctuation, or diagnostics.
