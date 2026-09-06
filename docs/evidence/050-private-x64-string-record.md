# Private x64 compiler string-record bytes

Baseline: bootstrap `d58e3936`.
The private MIR-to-x64 path now encodes the real compiler function
`artifact_result(manifest_path:str, artifact_path:str, status:str)` with exact
whole-function Windows-x64 parity. Emitted arrays and native comparison
executables are never executed. This is not module linking, artifact production,
compiler rebuilding, generated-compiler execution, or self-hosting evidence.

## RED to GREEN

The source parser/type/MIR producer was already exact: three borrowed string
loads, three `CloneString` instructions, `ReturnValues6`, max stack 6. Calling
the missing private x64 encoder failed while building the probe with exit 1 and
the exact existing diagnostic:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

RED: **0/1**, 8942.6725 ms total.

The new backend-only encoder consumes validated opcode/operand arrays. It does
not inspect source text or function names. For each string it:

- loads the borrowed pointer and signed length cells;
- decodes owned/borrowed signed length representation exactly;
- checks allocation-size overflow and calls runtime slot 10 (`abort`) on
  overflow;
- calls runtime slot 8 (`malloc`) with `length + 9` bytes;
- calls slot 10 on allocation failure;
- writes the length header, copies every byte, writes NUL, advances the result
  pointer past the header, and stores the negative owned-length encoding; and
- transfers each owned pointer/length pair through source-ordered
  `ReturnValues` cells.

All forward decoded/overflow/allocation/empty branches and backward byte-copy
branches use the existing private rel32 patch helper after target positions are
known. Windows and SysV pointer argument registers remain distinct. No runtime
slot or ABI changes.

First GREEN: **1/1**, 10415.1526 ms total. Hardened GREEN: **1/1**,
12041.7416 ms total, covering 18 malformed raw-MIR shapes: empty/mismatched
arrays, bad parameter/max-stack values, invalid/fractional locals, missing or
reversed string cells, nonconsecutive pairs, bad clone metadata, repeated
clone, borrowed escape, odd result count, understated stack, nonterminal return,
and unsupported opcode. Every rejection returns `valid:false, bytes:[]`.

## Regression and identity

Serial checkpoint including new test: **27/27**, exit 0, 106230.4096 ms. Full
bundle was 12823.7797 ms; focused x64 string record was 12025.0079 ms; locked
source-graph fixed point was 9904.5395 ms. Separate unchanged bundle repeat:
**1/1**, exit 0, 15481.6309 ms total (15395.7815 ms test). Timings are receipts,
not performance claims.

Fresh public browser artifacts remain byte-identical to archived baseline; no
private helper is exported. No public source syntax, semantics, API, schema,
ABI, diagnostic, optimizer policy, timeout, assertion, or fallback changed.

| Identity | SHA-256 |
| --- | --- |
| Machine source, canonical LF | `0f6ed2e3ea3562599594ddce2d228cbc3cae124542f51761030bf8667daab2ab` |
| Bootstrap manifest, canonical LF | `e4bd84674e88baab8b793a7a13661e6e682b80aacc4763d9bb9b210cc0dd8ee2` |
| Ordered bundle | `f01fc9c0b5a7d37a5b5445bb92bc511dd02c2f25d0f0a6def929674313d9b863` |
| Focused test, canonical LF | `cf8d7576b1c524062a1e5e8cb7d364562e0c682e0d2c8cdc087a1f65cc6d64e9` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next boundary: compose source-produced function bytes through symbol placement
and call relocation without restoring a fixed-grammar frontend. The frozen
compiler still self-copies; source-responsive successor production,
generated-compiler execution, deterministic compiler fixed point, broad strict
ecosystem parity, fallback removal, and exact I240 seed remain missing.
ADR-0005 remains conservatively 60%.
