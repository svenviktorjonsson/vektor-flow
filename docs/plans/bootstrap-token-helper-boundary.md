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
