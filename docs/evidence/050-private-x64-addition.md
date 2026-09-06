# Private whole-function addition bytes

Baseline: bootstrap `5d11791a75e2b949ba09aed8a7b129bdb02152f3`.
This packet adds ordinary numeric addition to the existing private borrowed-
vector scalar-function encoder. It does not execute emitted code or replace
the frozen self-copy bundle with a source-responsive compiler successor.

## RED to GREEN

The first new runtime-source test is a one-field record function returning
`items.length() + 1` for `[str]`. Native compilation and whole-function oracle
emission succeed with unchanged mask-0 defaults; the private pipeline parses
successfully but rejects the unsupported addition instruction. Exact RED:
`true`, `false`, `[]`; **0/1**, 9809.7386 ms total.

Native arithmetic in `vkf_x64_artifact.cpp:13097` already shares operand loads
and the result store for divide and addition. The private encoder now uses
that same shape and selects native opcode `0x58` for addition, retaining
`0x5e` for divide. Both require two numeric stack cells and zero metadata
operand. There is no duplicate encoder, reassociation, special-case recognition
of `length()+1`, new public opcode, or optimizer-tier override.

First GREEN: **1/1**, 11012.5379 ms total. Expanded focused GREEN: **1/1**,
14103.9813 ms total. Ten source cases cover the prior vector cases plus
renamed/reordered parameters, decimal literal on the left, two runtime vector
lengths, nested addition, and the native folded `(9007199254740992 + 1)`
boundary. All complete private functions match complete native function byte
arrays exactly. An explicit comparison also proves the `length()+1` function
bytes differ from the otherwise equivalent original length function.
Thirty-two malformed private inputs retain empty-byte rejection, including
addition underflow, vector operands on either side, nonzero metadata, and an
understated maximum stack. These are cases, not completion percentages.

The existing native oracle is unchanged. It still compares exact native MIR,
isolates the complete function using an independently emitted entry boundary,
and never executes the comparison artifact. Required count instructions keep
native integer/register-cache tiers naturally ineligible even though mask-0
leaves those defaults enabled. Windows x64 is the only verified target.

## Regression and visibility

Run the same environment and full checkpoint command as
`050-private-x64-vector-length.md`; the existing focused test is expanded.
Full checkpoint: **26/26**, exit 0, 89621.5894 ms. Full bundle within that run:
13796.315 ms; locked graph: 10371.6642 ms. A further unchanged full-bundle run
passed **1/1**, exit 0, 13137.2969 ms total (13041.5431 ms test). No assertion,
tolerance, timeout, or acceptance gate is weakened. Timings are receipts only.

The canonical I94 source/bundle hashes are mechanically refreshed. All machine
code from `# Private scalar expression fragment` onward remains byte-identical,
including prior private parser/MIR and public helpers. Existing entry/prefix
encoding is unchanged. Regeneration with
`node tools/build-browser-compiler.mjs --output build/private-parser-visibility/x64-addition-output`
matches the untouched archived baseline public WASM and manifest exactly;
there are no private helper exports. No shipped browser artifact is changed
or deployed by this packet.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `686f56f0d7410ac7afb38490b7c1ee4ff6a64103434c7852eb6360a3bca7bdf4` |
| Bootstrap manifest, canonical LF | `dafca147be1b025758f96fa1ab7f1c13ac1398cb6714fcbaddf98eea7cddf7e1` |
| Ordered bundle | `9f3698c84f5c0f356a0e1090ccb79f34ccb1ea3ef673f1165406994168c123c9` |
| Expanded test, canonical LF | `276ec5bc575a2b890f72055b73ef8c81f326a652a6f7be2fa11ea68a376b31e7` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next narrow boundary: source-ordered numeric `ReturnValues` for fewer than
eight fields, following native `vkf_x64_artifact.cpp:13394`. At eight or more
results native may use a host-AVX2 copy path independently of mask-0; that
path must not be silently replaced or disabled. Cloning/ownership, multi-value
runtime execution, container composition, and the compiler successor remain
separate. The missing exact I240 seed and frozen self-copy gap are unchanged;
no bootstrap percentage is promoted.
