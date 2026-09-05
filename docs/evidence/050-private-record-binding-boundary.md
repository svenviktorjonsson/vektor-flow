# Private record/binding boundary

Base: bootstrap `08d21bbd2e276e64a8886e428444d864231398aa`.
This resolves the private parser defect discovered in
`050-private-expression-types.md`.

Native AST distinguishes `(name:value)` (a `bind_expr` inside a block) from
`(name:value,)` (a one-field `record_literal`). Two-field records are likewise
record literals. The record-only private declaration stage must not accept
the binding form as a record.

## RED and correction

The focused test initially passed the actual record cases but returned
`true`, token 16, for `(original:items)` where the record-only stage should
return invalid at closing token 14: **1/2**, 4170.119 ms total.

The correction tracks commas only at the outer record-field level. A comma
inside `pair(items, items)` cannot turn its containing binding into a record.
Negative cases cover a bare value, grouped value, and nested call; each is
independently verified as native `bind_expr`. Positive cases cover one-field
records with trailing commas, nested calls, and the existing general
multi-field functions. Source spans and first-error ordering are retained.

The old malformed-span harness named a no-comma binding `valid`. Its base now
uses the actual record `(original:items,)`. That adds one token, so the
existing extra-EOF check moves from index 16 to 17. This keeps the original
extra-EOF gate testing extra EOF, rather than being masked by the earlier
record-shape rejection. All malformed-span checks, assertions, and timeouts
remain; no acceptance gate was relaxed.

Focused parser/expression/type tests passed **6/6**, 6092.0322 ms. The final
full adjacent suite passed **21/21**, 45840.5075 ms; full executable bundle
11023.1192 ms, locked source graph materialization 7963.3512 ms. Durations
are test receipts, not performance claims.
A second unchanged full-bundle run passed **1/1**, 15014.3522 ms total
(14921.445 ms in the test).

Run the full command and environment in `050-private-expression-types.md`.
The native-binding assertions were included in this final full run.

## Private boundary and identities

Only the non-manifest `_bootstrap_record_function_shape` implementation
changes. Existing public/manifest-callable helpers, token rows, source spans,
diagnostics, syntax, and ABI remain unchanged. The canonical source-lock
refresh changes only parser and ordered bundle hashes.

```powershell
node tools/build-browser-compiler.mjs --output build/private-parser-visibility/record-output
```

With the same tools/environment and untouched baseline archive documented in
`050-private-record-function-shape.md`, the regenerated files compare exactly
to `build/private-parser-visibility/baseline-output`; private helper names
remain absent from the generated manifest. No shipped artifact was changed
or deployed.

| Identity | SHA-256 |
| --- | --- |
| Parser, canonical LF | `10a072b02230a513600b421da3358bb897029f05bba7d1885c33dbdbebb29d4d` |
| Bootstrap manifest, canonical LF | `4f96233bcf8fb17fc487c937ab8a3f2736ea10ba561933b4338dbad492a1662e` |
| Focused shape test, canonical LF | `d6cdbd9c2682fc4f44a301a5a89285d0d6a90eb0553937862064e1a745462280` |
| Ordered bundle | `2f2aef651a9e97e92b1466ca326d658eafc097c1976de6855d4dfc62b2557dcd` |
| Identical regenerated WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Identical regenerated manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

No expression evaluation, lowering, or compiler self-production is added.
The source-response audit remains RED; the exact I240 seed is still missing.
The pending exponent/helper/diagnostic decisions and `[str]` transport gap
remain open. No bootstrap percentage is promoted.
