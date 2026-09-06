# Private compiler manifest-record Machine IR

Baseline: bootstrap `9853d35d5e6abdac349a3fd00ecca49334e1ac8a`.
This packet advances the private source/parser/type/Machine-IR path through the
real multiline compiler function `manifest(...)`. It proves structural native
MachineFunction parity only. No emitted Machine IR or native comparison
executable is executed. This is not module linking, artifact production,
compiler rebuilding, generated-compiler execution, or self-hosting evidence.

## RED to GREEN

The unchanged compiler function has nine scalar `str` parameters and a
multiline nine-field record body. The private producer initially rejected token
index 2, the layout token immediately after `manifest(`, and returned
`valid:false`, empty opcodes, empty operands, and max stack 0: **0/1**,
8907.2697 ms total.

The shape parser now skips layout only at declaration and record separators:
after an opening parenthesis, after a parameter or field comma, before a closing
parenthesis, and between the function header and record body. Layout remains a
hard boundary inside an expression. Per-parameter and per-field comma state
prevents layout from accepting adjacent declarations or fields without a
comma. New exact negative cases reject a missing multiline parameter comma at
token 9 and expression-internal layout at token 15.

The resulting MachineFunction matches the native oracle exactly: nine borrowed
string parameter pairs in source order; nine repetitions of `load_local`,
`load_local`, `clone_string`; `ReturnValues18`; max stack 18; and unchanged
local-class, ownership, error, and result metadata.

First GREEN: **1/1**, 9047.5402 ms total. Hardened GREEN: **1/1**,
9092.1264 ms total. Focused parser/type/MIR plus source-digest gates passed
**7/7**, exit 0, 10468.3541 ms total.

## Regression and identity

The serial checkpoint passed **27/27**, exit 0, 90758.3229 ms. Its complete
bundle gate was 11431.343 ms and locked source-graph fixed point was
8428.0907 ms. A separate unchanged bundle repeat passed **1/1**, exit 0,
11242.4156 ms total (11159.6859 ms test). Timings are receipts, not performance
claims. `git diff --check` passed with only existing LF-to-CRLF warnings.

Fresh browser compiler generation under the established native tool root is
byte-identical to the archived baseline. The initial generation invocation
without that environment failed before output with missing default
`build/native-compiler-clang/bin/vkf-strict.exe`; it wrote no artifact. No
private helper is exported. No public syntax, semantic rule, API, schema, ABI,
diagnostic, optimizer policy, timeout, assertion, or fallback changed.

| Identity | SHA-256 |
| --- | --- |
| Parser source, canonical LF | `4420e6c162e07b7135482d187417210bf9d0f7474965f87484d3b89d019cd010` |
| Bootstrap manifest, canonical LF | `ffb986f10daabc07a7a0317ec9de9d6d739ab00c3779ca90801e407529a1a7cf` |
| Ordered bundle | `25661ba9bb155ecb7725c4a27927b953f1a53b3310add203a020cc960ae024e9` |
| Record-MIR test, canonical LF | `f621d2e2a27c110b921c8bc37deb90e2c26cfac4157be6f3e2577525f585b382` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

Next bounded RED: exact native x64 ownership and return transport for this same
18-cell manifest result, without source-name dispatch or a fixed-grammar
frontend. The frozen compiler still self-copies; source-responsive successor
production, generated-compiler execution, deterministic compiler fixed point,
broad strict ecosystem parity, fallback removal, and the exact I240 seed remain
missing. ADR-0005 remains conservatively 60%.
