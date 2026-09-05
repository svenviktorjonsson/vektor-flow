# Runtime-input self-hosted comment tokenization

## Scope

Branch `bootstrap`, base `35cdbabe18481c5d91121b616b515e966a19cb47`.
This base reuses the already verified main decimal-parsing implementation
(`bb62d2ae`) as `35cdbabe`; it does not introduce another decimal parser.

The existing VKF-authored statement and numeric-function token-tape producers
now skip native `#` line comments and non-nesting `##...##` comments. They
preserve token values, UTF-8 byte offsets, source locations, their existing
newline/EOF contracts, and comment markers inside strings. No public syntax,
token schema, or diagnostic wording changes.

The test compiles a producer once, then supplies the input filename through
stdin and reads its source at runtime. Compiler constant folding therefore
cannot substitute a precomputed token tape for the behavior under test.
Ordinary tokens are compared with `vkf_lexer_cursor_smoke`; the two tape APIs'
different layout-token contracts are checked separately. This is not complete
lexer token-stream parity or complete language coverage.

## RED and GREEN

Environment: Windows x64 `10.0.26200.0`, Node `v22.14.0`, MSVC
`19.44.35217` Release/Ninja native tools under `build/native-windows/bin`.
All temporary files and archived baseline source remain inside this checkout's
`build` directory. Crash-capable runs inherit `SetErrorMode(0x8003)`.

The fresh RED uses an archive of the unchanged base lexer, without changing
the working tree:

```powershell
git archive 35cdbabe compiler/self_hosted/lexer.vkf --output build/comment-baseline.zip
Expand-Archive -LiteralPath build/comment-baseline.zip -DestinationPath build/comment-baseline
$env:VKF_NATIVE_BIN = (Resolve-Path build/native-windows/bin).Path
$env:VKF_TEST_WORK_ROOT = (Resolve-Path build/bootstrap-tests).Path
$env:VKF_LEXER_SOURCE = (Resolve-Path build/comment-baseline/compiler/self_hosted/lexer.vkf).Path
node --test tests/bootstrap/stage1-comment-token-producer.test.mjs
```

Exit `1`, **0/4 passed**, 2765.9109 ms. Valid comment cases exited `3`
instead of `0`; malformed comments propagated
`function token tape encountered unsupported punctuation` instead of the
canonical `Unterminated multiline comment`.

With `VKF_LEXER_SOURCE` unset, the same four tests pass. The malformed-input
test checks both APIs with `##`, multiline Unicode content, and an unclosed
comment after an expression. It catches the existing VKF assertion, binds its
message, and compares that text exactly with the native lexer diagnostic.
It does **not** claim the uncaught native assertion path prints diagnostics:
that existing path still exits `3` without text. Direct printing inside a
catch also exposed a separate inherited output-effect gap; this test uses the
established `$.message` binding pattern from `tests/vkf/control_flow.vkf`.

The source-graph gate independently failed on the stale lexer digest before
refresh. The manifest was refreshed mechanically with the established I94
recipe: SHA-256 of LF-normalized source, then SHA-256 of ordered
`path + newline + source_sha256` entries joined by newlines. Only the lexer
and bundle digest values changed; no source order or schema changed.

## Adjacent regression

Set `VKF_BUNDLE_ARTIFACT_TOOL` to
`build/native-windows/bin/vkf_bootstrap_bundle_artifact_smoke.exe`, and set
`TEMP`/`TMP` to the checkout's `build/bootstrap-tests` for the decimal fixture.

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-comment-token-producer.test.mjs tests/bootstrap/stage1-direct-decimal-parse.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage1-ast-to-ir-logical-chain.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

Exit `0`, **12/12 passed**, 27853.3082 ms. Full executable bundle: 10642.6775 ms;
source-graph materialization: 7730.6718 ms. No timeouts or assertions changed.

After the archived-baseline RED, repeat the current comment/source-graph tests
and full bundle:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-comment-token-producer.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

Exit `0`, **7/7 passed**, 15596.1554 ms. Second full bundle: 10457.694 ms under
the original 60000 ms child-process deadline. These observations are correctness
receipts, not a performance claim.

## Artifact identities

SHA-256, canonical LF bytes for source files:

- Base lexer: `14f181225e5f4a989c8519b19296c59ec68c415780be332889d6f95b70b866c0`
- Updated lexer: `936e8ff64885a2f917ca9ff408c3dbe5d7d4ccb712ba2f7d7147466654fd6336`
- Ordered bundle: `24c4455a06a47418f344e254123a62152dfaa0279c0f605ec8544e345508141b`
- Manifest: `5c033fa58424936e3fd8590a587e86fd6e429c1a8334809e86fae403840572be`
- Test: `7facef2a1a40e5e5d1b25117f3a90dcd11ce76bab54a510b00596efd2e006e62`
- Native verification compiler: `1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b`

## Bootstrap acceptance boundary

No ADR-0005 gate is promoted to complete by this packet. The existing test
named `stage2-locked-source-graph-fixed-point` materializes source bytes and
copies its own executable (`io.read_bytes(self_path)` to `next_compiler_path`).
`_compile_locked_valid_source_graph` currently returns the supplied sources.
Those byte-equality checks do not prove genuine compiler-source Stage 1 to
Stage 2 to Stage 3 self-compilation. The bundle smoke proves executable source
units, not that they compile the whole compiler. The historical 60% handover
estimate is not a newly verified full-bootstrap percentage.

I240 remains blocked by the missing exact runner seed, SHA-256
`8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`.
No rebuilt seed has been substituted, and its locked PE gates were not rerun
against a mismatched image. See `050-i240-locked-runner-recovery-audit.md`.

Next independent slice: exercise the runtime-input producer against the next
unsupported construct in actual compiler source, retaining native token/value
and source-order diagnostic evidence. Broad parser/lowering coverage and
genuine source-driven compiler reproduction remain required.
