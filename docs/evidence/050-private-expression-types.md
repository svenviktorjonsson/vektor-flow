# Private expression type facts

Base: bootstrap `d5eae96b40eaa3e432e925ea596a0dec6709b1c6`.
The new private `_bootstrap_expression_types` stage consumes the previously
validated declaration spans, token tape, and expression arena. It resolves
vector parameter names, numeric literal types, grouping, the existing
zero-argument vector `length` member, and ordinary numeric addition.

Facts retain one private type code and parameter reference per arena node.
Vector element types remain losslessly referenced through declaration spans;
no `[str]` value transport is introduced. The test serializer recovers the
canonical vector type from the original declaration token, not whitespace in
the source spelling. Type codes are private, not public typed IR or ABI tags.

This is not a standalone type checker for arbitrary VKF, a source validator,
an evaluator, a lowering/code-generation stage, or a source-responsive
successor. Validated source spans and arena construction are prerequisites.
It does not validate arbitrary externally supplied source/tape pairs. It
checks its vector lengths, node/token references, child order, argument
offsets, and numeric surface flags before using those internal facts.

## Native parity and RED to GREEN

`tests/bootstrap/stage1-private-expression-types.test.mjs` compiles a real
VKF runtime-input harness with optimizer policy `mask-0`. For each source it
uses the native lexer, parser, and AST-to-IR tools as the oracle, then compares
the complete reconstructed expression IR without dropping native fields.
The JavaScript code only serializes the private facts; it never evaluates VKF.

Incremental receipts:

- Missing resolver entrypoint: 0/1, 1807.8295 ms total; native compilation
  reported `direct x64 backend unsupported: machine IR supports direct calls only`.
- General parameter loads: GREEN 1/1, 2525.1848 ms. Renamed/reordered vector
  parameters resolve to their declared element types, not fixture names.
- Numeric literals/grouping: invalid at integer token 13 (2599.7145 ms);
  GREEN 1/1, 2805.5565 ms. Integer surface is `int`; decimal surface, including
  `1.0`, is `num`. Grouping preserves child facts.
- Vector member/call: invalid at `length` token 19 (2919.4826 ms);
  GREEN 1/1, 3008.2459 ms. Native IR's field type is `fn()->int`, call type
  `int`, and positional/named/spread argument vectors are empty.
- Actual `sources.length()+1`: invalid at PLUS token 22 (4160.9926 ms);
  GREEN 1/1, 3466.5458 ms. Mixed `int`/`num` addition produces native `num`
  while preserving each operand's original type. Nested/grouped variants
  retain the exact native IR structure.
- Corrupt numeric surface flag `2`: incorrectly valid (2204.6171 ms);
  now rejected. Only the parser's `0`/`1` surface flags are accepted.
- Duplicate vector parameter name: incorrectly valid (2174.7507 ms);
  now rejected at the second parameter token before resolving the body.
  Native independently reports
  `<ast-to-ir>:1:1: Cannot declare duplicate parameter items`.
  The private stage returns a token index; it does not emit or modify that
  public diagnostic.

Final cases include the actual compiler function before/after `+1`, unrelated
names and field order, different vector element types, decimal/integer
literals, whitespace inside a vector type, a Unicode comment prefix, grouped
member calls, and mixed addition. Negative cases cover unresolved names,
unsupported members/arity/vector addition, future/fractional child indices,
invalid call offsets, and invalid numeric flags. An earlier unresolved name
wins over a corrupt later token reference. Duplicate declarations win over
an unresolved body name. These are private unsupported-result checks, not a
claim that all unsupported cases are illegal in native VKF.

## Separate parser boundary discovered

The first proposed load fixture used `(copy:values)`. The native parser/typed
IR correctly classifies this as a `bind_expr`, not a record. The committed
private declaration-shape parser accepts that parenthesized binding as a
record-shaped result. The resolver test now uses the unambiguous two-field
record `(copy:values, original:values)`.

This is a pending private parser-correctness boundary, reported to root, not
fixed or counted as passed in this packet. Required next RED: compare
`(copy:values)` against `(copy:values,)` and a two-field record using native
AST; the record-only private entry must reject the bind expression and accept
actual record syntax. Preserve existing helper/public bytes and expression
source spans. No public syntax decision or new interpretation is implied.

## Unchanged public behavior

Only a new private function is added in `typed_ir.vkf`; every pre-existing
helper and parser body remains unchanged. The I94 canonical hash refresh
updates only this source's digest and the ordered bundle digest. No public
syntax, schema, ABI, diagnostic, native compiler header, or shipped browser
artifact changes.

Using the same native tools and untouched baseline archive documented in
`050-private-record-function-shape.md`:

```powershell
node tools/build-browser-compiler.mjs --output build/private-parser-visibility/types-output
```

The regenerated WASM and manifest compare byte-for-byte with
`build/private-parser-visibility/baseline-output`. The manifest contains no
`_bootstrap_` or `BootstrapExpressionTree` name. This compares regenerated
baseline/current artifacts, not current versus older shipped files.

| Identical regenerated artifact | SHA-256 |
| --- | --- |
| WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

## Regression and source identities

Windows x64, Node 22.14.0. Full adjacent suite plus private type tests: exit 0,
**21/21**, 45885.7088 ms total. Full executable bundle: 11304.2324 ms;
locked graph materialization: 8036.4401 ms. Durations are receipts, not
performance claims. No assertion, acceptance gate, or timeout was weakened.
A second unchanged full-bundle run passed 1/1, 12065.1869 ms total
(11961.5131 ms in the test).

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-private-expression-types.test.mjs tests/bootstrap/stage1-private-expression-tree.test.mjs tests/bootstrap/stage1-private-record-function-shape.test.mjs tests/bootstrap/stage1-comment-token-producer.test.mjs tests/bootstrap/stage1-direct-decimal-parse.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage1-ast-to-ir-logical-chain.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

Use absolute `VKF_NATIVE_BIN=build/native-windows/bin`, the existing
`VKF_BUNDLE_ARTIFACT_TOOL`, and this checkout's `build/bootstrap-tests` for
`VKF_TEST_WORK_ROOT`, `TEMP`, and `TMP`. Runs inherit `SetErrorMode(0x8003)`
only to suppress crash dialogs. All build outputs remain ignored and local.

| Identity | SHA-256 |
| --- | --- |
| Typed IR source, canonical LF | `bbe9b192e9a015d0132add24ab1ed2e38c6552a02ff79ffc66c79d316c536f0c` |
| Bootstrap manifest, canonical LF | `759222be8baad506bbf8583306dcd0b66af9a57939dcd753ff0aab115a3bbe16` |
| Focused test, canonical LF | `ca4e2b970e51d150ac71cb9237c3cce38e9f96f1468da1f129c31ea6b412ff6c` |
| Ordered bundle | `68ee714d1d11b2f8a5cf544a6ad56c8688b683552998300f91ab1dc2b515a311` |
| Native compiler | `1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b` |
| WASM artifact tool | `f34ce9ea97e0701d67af70f51783c10da5b32df2ac880e950894cac57e40e977` |

The private exponent token mismatch, helper ABI decisions, uncaught diagnostic
transport, and `[str]` runtime value/display gap remain open. The exact I240
seed is still missing and has not been substituted. Existing stage production
still self-copies; the intentional source-response audit remains RED. This
packet neither promotes a bootstrap percentage nor deploys browser files.
