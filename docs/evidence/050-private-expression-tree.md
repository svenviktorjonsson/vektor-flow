# Private expression syntax tree

Base: bootstrap `18fa4d43e07984d3fee169ad0b226c60f9eb5eb0`.
The new private stage consumes the existing lexer tape and declaration parser's
expression spans unchanged. It builds a postorder arena for identifiers,
ordinary numeric literals, grouping, attributes, positional calls, and
left-associative addition. It parses the actual `sources.length() + 1`
expression and renamed/reordered variants without recognizing fixture names.

This is syntax only: no expression evaluation, type checking, lowering, or
successor generation is implemented here. The general compiler parser and the
source-responsive successor remain incomplete. No bootstrap percentage moves.

## RED to GREEN

The focused runtime-input test was developed incrementally:

- Missing entrypoint: 0/1, 1532.1354 ms; native compilation reported
  `direct x64 backend unsupported: machine IR supports direct calls only`.
- Numeric/grouping slice: invalid tree at `2.5`; native AST comparison then
  required retaining `is_integer_surface` and `parenthesized` metadata.
- Generic nested calls: invalid tree at argument token 15; repaired by general
  argument parsing, including nested calls and chained member calls.
- Actual `length() + 1`: invalid tree at PLUS token 22. Ordinary additive
  parsing now produces native-equivalent left-associative binary trees.
- Source-order error: a corrupt later span made `items.+later` report token 3
  instead of the earlier syntax error at 2. On-demand validation preserves 2.
- Trailing comma: `outer(items,)` returned `true`, index 5, instead of invalid
  at 4 (0/1, 1800.7784 ms). Native `f(a,)` reports
  `<cursor-smoke>:1:5: unsupported token RPAREN`. Private parsing now rejects
  the closing token after a comma.
- Literal classification: the unchanged tape classifies `true`, `false`, and
  `null` as IDENT. Native `scan_identifier` in
  `compiler/native/vkf_lexer_cursor_smoke.cpp` classifies them TRUE/FALSE/NULL.
  The private stage initially accepted `true` as an identifier (0/1,
  1688.5638 ms). It now rejects these unsupported literals, including member
  positions; this is not literal support or a lexer repair.

The final enabled tests compare exact native ASTs, not normalized subsets.
They cover generic names/types/field order, nested positional calls, grouped
expressions, chained attributes, integer and decimal surface metadata,
addition associativity, and a Unicode comment prefix. Every node retains an
original bounds-checked token location. Arena references must be postorder,
acyclic, in bounds, and fully reachable. Test-only AST serialization does not
evaluate VKF.

Malformed input tests require exact private error indices, empty stderr, and
normal exit. Negative/fractional/past-end spans, missing operands, crossed or
missing delimiters, trailing commas, and earlier syntax errors before later
corrupt spans are rejected. Existing public diagnostics are untouched.

## Explicit pending lexer parity

An attempted `1e0` positive case exposed a separate genuine RED: native emits
one NUMBER, but the existing tape emits NUMBER `1` followed by IDENT `e0`.
The expression parser stopped at that IDENT (token 26 in the tested function).
No exponent repair or source-pattern interpretation was added here.

With root approval, the positive decimal case uses `1.0`; the unsupported
exponent boundary is retained in
`tests/bootstrap/stage1-exponent-token-parity.test.mjs.pending`. It is an
explicit pending RED fixture, not an enabled acceptance gate and not counted
as passed. The standalone pending fixture has not been executed in this
packet; the runtime expression mismatch above was the observed RED. Any
change to the existing manifest-callable lexer requires its own authorized
parity packet. Boolean/null token classification is likewise not repaired.

## Unchanged public bytes

`git diff` contains additions only in `parser.vkf`; every pre-existing helper
body is unchanged. No native header, public syntax, diagnostic, token schema,
shipped artifact, or manifest-callable root changed. The source-lock refresh
changes only the canonical parser SHA and ordered bundle SHA using the I94
recipe (canonical LF; ordered `path + newline + source_sha256` records).

The existing build script regenerated the same pruned public entry from the
untouched `44201026` archive and the new source, using identical native tools.
The baseline archive and exact recipe are recorded in
`050-private-record-function-shape.md`. Current command:

```powershell
node tools/build-browser-compiler.mjs --output build/private-parser-visibility/expression-output
```

Both regenerated files compare byte-for-byte with
`build/private-parser-visibility/baseline-output`. No `_bootstrap_` or
`BootstrapExpressionTree` name occurs in the generated manifest.

| Identical regenerated artifact | SHA-256 |
| --- | --- |
| WASM | `2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817` |
| Manifest | `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41` |

This compares regenerated baseline/current outputs, not rebuilt-versus-shipped
identity. No browser artifact was deployed from this branch.

## Regression and identities

Windows x64, Node 22.14.0. Full unchanged-adjacent suite plus the two new tests:
exit 0, **19/19**, 42021.7716 ms. Full executable bundle: 11282.5347 ms;
locked graph materialization: 8762.0353 ms. These durations are receipts, not
performance claims. Original assertions and timeouts were not changed.
A second unchanged full-bundle run also passed 1/1, 11170.9824 ms total
(11084.6382 ms in the test).

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-private-expression-tree.test.mjs tests/bootstrap/stage1-private-record-function-shape.test.mjs tests/bootstrap/stage1-comment-token-producer.test.mjs tests/bootstrap/stage1-direct-decimal-parse.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage1-ast-to-ir-logical-chain.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

Use absolute `VKF_NATIVE_BIN=build/native-windows/bin`,
`VKF_BUNDLE_ARTIFACT_TOOL` pointing at `vkf_bootstrap_bundle_artifact_smoke.exe`,
and `VKF_TEST_WORK_ROOT`, `TEMP`, and `TMP` under this checkout's
`build/bootstrap-tests`. Runs inherit `SetErrorMode(0x8003)` to suppress crash
dialogs, not change assertion behavior.

| Identity | SHA-256 |
| --- | --- |
| Parser, canonical LF | `83315ecb3eaa673268357b47b7c8f8e8ac32c5e94a1f5595f8292653dcc1e81a` |
| Bootstrap manifest, canonical LF | `e882cc7e3c058e2a1ff1f4a95a1b8a88c555177e64201502ba655144c514ce83` |
| Focused test, canonical LF | `f66cc0714c520a2ad10305f7e04052686a11fd11c47cd25fd627a33442e1a469` |
| Pending exponent fixture, canonical LF | `37a0724c07ece428ed41c74e759bef59f08eaf6b79cc52741bc1d9fd1b676e44` |
| Ordered bundle | `d804136b82a0b2b1fb0c0b8a3d534585c34035fc63ad24c2b4040cf11b2546f5` |
| Native compiler | `1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b` |
| WASM artifact tool | `f34ce9ea97e0701d67af70f51783c10da5b32df2ac880e950894cac57e40e977` |

The separate `[str]` value/display transport gap remains undiagnosed; this
numeric arena does not establish string-vector support. Pending helper ABI
and uncaught diagnostic decisions remain open. The missing exact I240 seed
is not substituted. The existing compiler production still self-copies; the
intentional source-response audit remains RED.
