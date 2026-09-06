# Private x64 source-function composition

Baseline: bootstrap `2079a62e105490811db2ec50a8161495b34fa5c2`.
This packet composes exact x64 bodies produced from the real compiler functions
`artifact_result` and `manifest` through computed symbol positions and signed
call relocations. The composed bytes are not executed or placed in a container;
this is not compiler rebuilding, generated-compiler execution, or self-hosting.

## RED to GREEN

The first source-driven composition probe failed to compile with the existing
diagnostic `direct x64 backend unsupported: machine IR supports direct calls
only`: **0/1**, 8933.8011 ms total.

The new private composer accepts one flattened byte arena, source-ordered
function lengths, relocation-owner indices, owner-relative placeholder offsets,
and target-function indices. It computes symbol positions from lengths, copies
validated byte values into fresh storage, validates every `E8 00 00 00 00`
site, rejects duplicate sites, checks signed-rel32 range, and applies the
existing target-relative patch helper.

The positive case uses the exact source-produced six-cell `artifact_result`
body and 18-cell `manifest` body plus a non-executed two-call fragment. An
independent JavaScript oracle computes both backward relocations byte-for-byte.
Twelve malformed arena, length, cardinality, owner, target, offset, opcode,
placeholder, and duplicate-relocation cases fail closed. First GREEN: **1/1**,
9672.3142 ms. Hardened GREEN: **1/1**, 11071.108 ms.

## Regression and identity

Serial checkpoint: **28/28**, exit 0, 107458.5757 ms. Complete bundle was
11428.3365 ms, composition 10958.3981 ms, and locked source-graph fixed point
8574.3981 ms. Separate bundle repeat: **1/1**, exit 0, 11511.4226 ms total
(11430.7996 ms test). Timings are receipts, not performance claims.

Fresh browser compiler generation is byte-identical to archived baseline. No
private helper is exported. No public syntax, semantics, API, schema, ABI,
diagnostic, optimizer policy, timeout, assertion, or fallback changed.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `7ba30349acde47a52d241b56814a823959f8ada9503aee0c4c33cf240e315395` |
| Bootstrap manifest, canonical LF | `ac5f9971899b597e4c408d536102424809d203cc51b5d4fee742329ed5e1b469` |
| Ordered bundle | `e25420caa7f80d2e483a1931784cb0e8eae238c8bfcec119f0385ef20a803039` |
| Focused test, canonical LF | `7a4d569174a0ef246380630ae8215f4d6e1c42aa55c014309640a6d1c6d4e104` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next boundary: place composed source-produced bodies into the owned PE code
section before connecting them to a source-derived entry function. Frozen
self-copy, source-responsive successor production, generated-compiler
execution, deterministic compiler fixed point, broad parity, fallback removal,
and exact I240 seed remain missing. ADR-0005 stays 60%.
