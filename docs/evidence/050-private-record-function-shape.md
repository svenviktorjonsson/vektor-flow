# Private declaration/record shape parser

Base: bootstrap `44201026b318d8af729e088291094524cd54b0f7`.
New private stages in `parser.vkf` consume the existing six-cell lexer tape
unchanged. They parse one function name, vector-annotated parameters, ordered
record fields, and balanced expression spans. Names/types/fields are general:
there is no recognition of the source-response fixture's function name,
`sources`, `length`, `source_count`, or `+ 1` semantics.

The canonical private representation retains byte spans into the original
source. This is not a new public AST/schema or a decoded string-value contract.
The stage returns `valid` and the first failing token index internally; it
does not install a new public diagnostic or change an existing one. Expression
grammar, type checking, full indentation, and successor code generation remain
later stages. A balanced expression span is not proof that its expression is
valid VKF.

## RED to GREEN

`node --test tests/bootstrap/stage1-private-record-function-shape.test.mjs`
first failed at the missing private entrypoint: 0/1, 1286.3485 ms total,
`<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only`.
This was an interface-establishment RED, not a runtime AST mismatch.

After implementation, the real compiler function and renamed/reordered
variants passed. The next negative-span RED exited 3 instead of returning an
invalid shape (0/1, 2682.0302 ms total). On-demand span validation repaired
that boundary. A crossed-delimiter case initially reported token 19 instead
of the first mismatched closer at 16; ordered delimiter storage repaired it.
An empty identifier span was then incorrectly accepted (`true`, token 16);
the final checks reject it at token 0 and require exact EOF consumption.

Final focused cases exercise:

- the actual `_compile_locked_valid_source_graph` function;
- alternate function, parameter, type, and field identifiers, including a
  two-parameter case, `Widget` element type, and reordered fields;
- a Unicode comment prefix and native token line/column reconstruction;
- nested calls, vector arguments, and parenthesized expression spans;
- negative, reversed, fractional, empty, and past-end spans, mismatched count,
  and trailing EOF records;
- crossed delimiters, empty field expressions, and an empty tuple where a
  record body is required;
- an earlier syntax error at token 1 taking precedence over a later corrupt
  span, without scanning ahead and changing the first error.

Input arrives at runtime through `io.read_line`/`io.read_text`. Names, vector
type annotations, and field order are compared against native lexer/parser
AST output; reconstructed expression bytes are compared exactly. Every emitted
span must be integral, in bounds, and start at a canonical native token
location. These are structural parser tests, not JavaScript execution of VKF.

## Unchanged public behavior

No existing lexer or parser helper body changed. New private helpers are not
referenced by an existing manifest-callable root. No native header, shipped
WASM/manifest, public syntax, schema, ABI, or diagnostic was changed.

The stronger check rebuilt the same pruned browser entry from an untouched
HEAD archive and the final source, using identical native tools. Both builds
used `run_tagged_dependency_source` and `--prune-to-entry` through the existing
`tools/build-browser-compiler.mjs`. Byte comparisons passed, and no
`_bootstrap_shape*` or `_bootstrap_record_function_shape` name occurs in the
generated manifest.

Reproduction (outputs remain under this checkout's build directory):

```powershell
git archive --format=zip --output=build/private-parser-visibility/baseline.zip 44201026 compiler/self_hosted tools/build-browser-compiler.mjs
Expand-Archive -LiteralPath build/private-parser-visibility/baseline.zip -DestinationPath build/private-parser-visibility/baseline
node build/private-parser-visibility/baseline/tools/build-browser-compiler.mjs --output build/private-parser-visibility/baseline-output
node tools/build-browser-compiler.mjs --output build/private-parser-visibility/final-output
```

Use `VKF_NATIVE_BIN=build/native-windows/bin` as an absolute path and set
`TEMP`/`TMP` to `build/bootstrap-tests` before both builds.

| Identical regenerated artifact | SHA-256 |
| --- | --- |
| WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

This compares regenerated baseline/current outputs, not a claim that the older
shipped artifacts already contain all earlier bootstrap work. Shipped files
remain untouched; there was no deployment.

## Regression and identities

Windows x64, Node 22.14.0. Final unchanged-adjacent suite: exit 0, **17/17**,
34087.4624 ms total. Full executable bundle: 10879.1138 ms. Source-graph
materialization: 7861.0296 ms. An earlier complete run also passed 17/17.
All original assertions, tolerances, and timeouts remain unchanged.

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-private-record-function-shape.test.mjs tests/bootstrap/stage1-comment-token-producer.test.mjs tests/bootstrap/stage1-direct-decimal-parse.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage1-ast-to-ir-logical-chain.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

Use the existing native/bundle tool environment and `VKF_TEST_WORK_ROOT`,
`TEMP`, and `TMP` under `build/bootstrap-tests`; runs inherit
`SetErrorMode(0x8003)`. The manifest refresh changes only the canonical parser
SHA and ordered bundle SHA via the established I94 hash recipe.

| Identity | SHA-256 |
| --- | --- |
| Parser, canonical LF | `d7af7a555122de1ca5d85ad27e5656a5cd9e18bd524be667913ee445a4b43faa` |
| Bootstrap manifest, canonical LF | `3c469bc726ff768da3ce3d5a21d32ae66ca82f3fce5126e149198c378a97cc32` |
| Focused test, canonical LF | `29eaa4c90a9b52b9611f407721153f4d9a285639c8281204faf49e9c41efa088` |
| Ordered bundle | `da6c57af8004c632700be2d85e5a28dd94322c622089a5bc5841a9ccc3ed9dbf` |
| Native compiler | `1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b` |
| WASM artifact tool | `f34ce9ea97e0701d67af70f51783c10da5b32df2ac880e950894cac57e40e977` |

During implementation, an attempted returned `[str]` record field printed
numeric cells instead of `['sources']`. That separate native value/display
transport gap is not repaired or fully diagnosed here; no string-vector
support claim is made. Source spans are the canonical private parser data, not
an alternate execution path.

The genuine source-response audit remains RED: existing stage production still
copies the compiler executable. This packet does not fix that seam, promote a
bootstrap percentage, resolve the pending helper/diagnostic decisions, or
substitute for the missing locked I240 seed.
