# Private x64 compiler manifest-record bytes

Baseline: bootstrap `3479c8bb7f5d38baf632bfca5e0c3b2b71695460`.
The private MIR-to-x64 path now encodes the real compiler function
`manifest(...)` with exact whole-function Windows-x64 parity for its nine
borrowed strings and 18 returned cells. Emitted arrays and native comparison
executables are never executed. This is not module linking, artifact
production, compiler rebuilding, generated-compiler execution, or self-hosting
evidence.

## RED to GREEN

Private source parsing and MIR construction succeeded. The x64 encoder rejected
`ReturnValues18` at its prior seven-cell ceiling and returned `valid:false,
bytes:[]`: **0/1**, 9834.0571 ms total.

The encoder now accepts an explicit private AVX2 target-feature selector. At
eight or more result cells it mirrors the native non-entry return path exactly:

- restores the result context;
- addresses the first temporary and result cell in `rax` and `rdx`;
- copies four cells per loop with `vmovupd`, using a patched backward rel32;
- emits `vzeroupper` before scalar code; and
- transfers the remaining two cells through the existing scalar XMM path.

For the 18-cell manifest result this is four 32-byte blocks plus two scalar
cells. Every field remains an owned pointer/negative-length pair produced by
the already-audited `CloneString` path, including signed length decoding,
overflow checks, runtime slot 8 allocation, runtime slot 10 abort, byte copy,
NUL termination, and forward/backward rel32 fixups. The explicit feature bit
also retains the scalar path for non-AVX2 targets; no runtime ABI changes.

One intermediate native compile failed with the exact existing diagnostic
`unknown binding blocks`; moving AVX2 return scratch bindings to function scope
resolved the VKF branch-local binding boundary. First exact GREEN: **1/1**,
11353.9981 ms total. Focused source/MIR/x64/digest gates passed **4/4**, exit 0,
16809.4962 ms total.

## Regression and identity

The serial checkpoint passed **27/27**, exit 0, 92700.1321 ms. Its complete
bundle gate was 11416.6627 ms, focused manifest/string x64 was 11166.0675 ms,
and locked source-graph fixed point was 8967.5173 ms. A separate unchanged
bundle repeat passed **1/1**, exit 0, 11888.4464 ms total (11799.0018 ms test).
Timings are receipts, not performance claims. `git diff --check` passed with
only existing LF-to-CRLF warnings.

Fresh browser compiler generation remains byte-identical to the archived
baseline; no private helper is exported. No public syntax, semantics, API,
schema, ABI, diagnostic, optimizer policy, timeout, assertion, or fallback
changed.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `2d1b4fbc3a67f15eb6c08016ee75c526204c576791329e474b331511cf3a0b90` |
| Bootstrap manifest, canonical LF | `125e7a353d5944ebb7ca74a8bb9416f703c6dde0d587dbeb62406439f121e3a9` |
| Ordered bundle | `ef99fe9dca30bebad6dbb02a122f925d0c873e606efad33bd0edc6a9bcacfa34` |
| Focused test, canonical LF | `0644d567be7d7c82799028de765958049a30f14c08ca906b681e9d7644339bde` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next boundary: compose source-produced compiler functions through symbol
placement and call relocation without restoring a fixed-grammar frontend. The
frozen compiler still self-copies; source-responsive successor production,
generated-compiler execution, deterministic compiler fixed point, broad strict
ecosystem parity, fallback removal, and the exact I240 seed remain missing.
ADR-0005 remains conservatively 60%.
