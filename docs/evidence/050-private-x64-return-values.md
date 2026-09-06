# Private numeric multi-value return bytes

Baseline: bootstrap `1efc3d30fcc1ec1328774bd82dff22c0109336cc`.
The private source-to-MIR function encoder now supports source-ordered numeric
`ReturnValues` with two through seven fields. Whole functions match native
Windows-x64 bytes; emitted arrays and native comparison executables are never
executed. This is not a runtime or self-compilation acceptance gate.

## RED to GREEN

The first new source returns `(count:items.length(), next:items.length() + 1)`
for a `[str]` parameter. Native compilation and exact MIR/oracle construction
succeed; private parsing succeeds but encoding rejects the return: `true`,
`false`, `[]`. RED **0/1**, 10731.4667 ms total.

The encoder follows existing native `ReturnValues` at
`vkf_x64_artifact.cpp:13394`: restore result context R11, load each source-
ordered temporary, store through R11 at negative eight-byte strides, then use
the existing epilogue. It validates the exact final stack depth, integral
result count, numeric cell types, and terminal return position before
publishing bytes. Scalar-return and entry/prefix paths remain unchanged.

During implementation, the native bootstrap compiler rejected a loop index
declared inside the opcode branch with its existing `unknown binding field`
message (**0/1**, 8849.8292 ms). Declaring that index at function scope resolved
the producer compile without changing native compiler behavior or diagnostics.
First multi-return GREEN: **1/1**, 12092.2992 ms total.

Expanded focused GREEN: **1/1**, 12782.3985 ms. Seventeen positive source
functions cover the earlier scalar cases, reversed field order, and every
return width two through seven. All whole-function arrays equal native;
reversing fields also explicitly changes emitted bytes. Forty-one malformed
private inputs reject with empty bytes, including wrong result counts,
non-numeric cells, return position, and understated stack depth.

A separate source with eight numeric fields compiles natively, produces native
`result_count:8`, and is parsed by the private producer, but this encoder
returns `valid:false, bytes:[]`. This is an explicit private boundary: native
uses a host-AVX2 copy path for eight or more results when available, independently
of mask-0. No tier is disabled or silently replaced. Borrowed count remains
required, preserving native integer/register-cache tier selection.

## Regression and identity

Use the same environment and commands as `050-private-x64-vector-length.md`,
with the expanded existing test. Full checkpoint: **26/26**, exit 0,
98312.5412 ms. Full bundle within that run: 12650.6143 ms; locked graph:
15417.9759 ms. Further unchanged full-bundle run: **1/1**, exit 0,
15328.3771 ms total (15205.7377 ms test). Timings are receipts, not performance
claims. No assertion, tolerance, timeout, or acceptance gate is weakened.

Canonical I94 lock refresh changes only machine-source and ordered-bundle
hashes. The machine file from `# Private scalar expression fragment` onward
is byte-identical to baseline. Regeneration using
`node tools/build-browser-compiler.mjs --output build/private-parser-visibility/x64-return-values-output`
produces public WASM and manifest identical to the untouched archived baseline;
no private helper is exported. Shipped browser artifacts remain untouched.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `fc575257c31a234a00e0e454451f9a6ff5e90fb12adfaddd1244241ef201b002` |
| Bootstrap manifest, canonical LF | `4622e3c017e73faa52c9e6b50214da1b281ab5ca5cbeb713604a599142afc65f` |
| Ordered bundle | `c17f325d963ceccfd9fac85b03bd308bf27ea3d4d110747cc95a6f46e9a5abcc` |
| Expanded test, canonical LF | `2a4ee22ee2d18947e1f8c5ee3fda642ed5900dd8be67269039551c4478e1b5b2` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next: audit native `CloneF64List` ownership, allocator/runtime-slot calls,
abort branches and relative fixups before encoding the original producer's
vector-valued record field. No ad hoc diagnostic transport is authorized.
Eight-field AVX2 returns, runtime/container composition, and the real compiler
successor remain separate. The frozen bundle still self-copies, its source-
responsive successor gate is RED, and the exact I240 seed remains missing.
No bootstrap percentage is promoted.
