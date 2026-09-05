# Ready for human: compiler token-helper compatibility

Status: proposed only; no token, export, or ABI change implemented.

## One decision

May undocumented compiler-internal helpers evolve while the browser compiler's
documented `compile` and `run` interfaces remain compatible?

The compiler needs its own ordinary equality syntax:

```vkf
cursor.peek() = "\n"?
```

- **A — Internal helpers may evolve (recommended).** Their token representation
  is not a supported integration contract; keep documented compiler interfaces
  compatible. This permits the narrow equality-token extension below.
- **B — Preserve exposed helper behavior.** Treat existing generic helper calls
  as supported integrations and prepare a versioned replacement before changing
  their results.

Counterexample: an integrator can currently call the internal punctuation helper
directly. `+` returns numeric code `2`; `=` traps. Under A, `=` may instead return
the new equality token code. Under B, the old helper must retain its behavior.

Reply: **choose A** or **choose B**. Removing helpers from published metadata
is not included in either implementation packet and would need separate review.

## Concrete evidence

At bootstrap `2ad3038819c508416e35d81284f0d57913d2f2d5`, the published artifact
manifest `web/playground/artifacts/vkf-browser-compiler.json` contains:

```json
"__vkf_module_lexer___tagged_function_punctuation_kind": {
  "index": 24, "parameters": 1, "resultType": 1
}
```

It also exposes `__vkf_module_lexer__tagged_numeric_function_token_tape` through
the same function-index metadata. These are **manifest-callable names**, not
literal WebAssembly function exports. The WASM module exposes the generic
`vkf_vm_invoke` function, and `createSymbolicKernel().invokeValue(name, args)`
uses the manifest's function index without a compiler-helper allowlist.

A read-only Node instantiation of the shipped WASM confirmed direct helper
invocation: `+` returned `2`; `=` raised `unreachable`. The manifest is therefore
observable despite no documented token-code decoder being found in `web`,
`tools`, or `spec`. Absence of an in-repository consumer does not prove absence
of external integrations.

## Proposed narrow change after approval

Add `26` for native `EQ` in the existing tape; preserve codes 1–25, six-cell row
layout, source spans, and source order. Do not change parser behavior, native
token JSON, VM ABI, manifest version, or published artifact in this packet.

Keep `==`, `=>`, `<=`, and `>=` rejected with the existing unsupported-punctuation
diagnostic until their own native-equivalent tokenization is implemented. They
must not be silently split into new single-equality tokens. `!=` and `~=` remain
unchanged. Compare exact equality locations and one-byte spans with native;
check strings/comments and malformed/composite inputs.

Consumer search found numeric tape readers in `lexer.vkf`, `parser.vkf`,
`compiler.vkf`, and bootstrap tests, with no existing kind `26` or 1–25 range
bound. `parser.vkf`'s `token_count = 26` is a complete fixture-length check,
not a kind assignment. Native/public token JSON remains named `EQ`.

## RED and rollback boundary

Runtime input of the full current `lexer.vkf` fails with
`function token tape encountered unsupported punctuation`. Testing successive
source prefixes locates the first such failure at line 29, the example above.
The fresh narrow fixture exited `1` (0/1 passed, 816.4925 ms total): the compiled
producer exited `3` instead of `0`. Native accepts the same prefix.

The proposed fixture is preserved as
`tests/bootstrap/stage1-equality-token-producer.test.mjs.pending`; it is not a
release acceptance test and is not counted as a pass. Restore its executable
test name only after approval. No source implementation or manifest change
exists to roll back. Compiler-source tokenization is not compiler self-hosting.

## Audited addendum: existing STRING25 boundaries

At bootstrap `7a468deda494ad546c0e4c6a5791663d8828cb6f`, whole locked-source
inventory identified another observable helper change covered by the A/B
decision. No triple-string RED or implementation has been run or claimed.

`native_scene_compiler.vkf:41` contains the actual triple-quoted docstring
`"""Return the stable session slug used by the native launcher."""`.
Native `vkf_lexer_cursor_smoke.cpp::scan_double_string` recognizes all three
delimiters, decodes escapes, dedents multiline values, and emits one `STRING`.
Private `lexer.vkf:634` scans to a single closing quote; its caller at line 679
advances over one opening quote. Inspection therefore predicts three STRING25
tokens for this literal. Correcting that changes manifest-callable tape results
even though code 25 and the six-cell row shape need not change.

Raw-span consumers must move together with any eventual decoding repair:

| Consumer in `compiler.vkf` | Existing interpretation |
| --- | --- |
| Camera projection, lines 3550–3552 | Requires code 25, strips one quote at each end |
| Light fields, lines 3639–3648 | Requires code 25, compares raw quoted light kinds, strips one quote |
| Rigid-body id, lines 4243–4245 | Requires code 25, strips one quote |
| Native timing boundary, lines 5026–5028 | Requires code 25, strips one quote |
| Native reference field, lines 5074–5076 | Requires code 25, strips one quote |

`_browser_token_text` returns the raw source span. Merely expanding the span to
three delimiters leaves extra quotes in these consumer values; it does not
establish decoded-string parity. The comment-token fixture also uses
`JSON.parse` on raw ordinary double-quoted spans and cannot serve unchanged as
a triple-string decoder oracle. Named native `STRING`/`STRING_RAW` parser
consumption and unrelated symbolic opcode 25 are distinct representations.

After A/B approval, the bounded RED must use the actual docstring as runtime
input and compare one complete span, decoded native value, and the following
token's location. Follow with multiline indentation, escapes, Unicode,
comment markers, and first-error malformed-string cases; then verify all
affected consumer values and existing single-string regression gates. Reuse
native behavior rather than adding a second decoder contract. Existing private
`unterminated string literal` differs from native wording: changing diagnostics
is not authorized by this helper decision and requires its own ready-for-human
packet. Source-order failures must not be skipped to make a test pass.

Under A, prepare a separately reviewed coherent token-and-consumer packet.
Under B, preserve existing callable results pending a versioned replacement.
This addendum changes documentation only; there is no implementation to revert.
