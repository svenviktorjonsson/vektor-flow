# Runtime-input escaped string boundaries

Base: `d52ce5c2b385daa1f7110031d286e4e68c200da3`, branch `bootstrap`.

The existing string scanner stopped at escaped double quotes. This prevents
scanning ordinary compiler literals such as `"\""`, even though native VKF
already accepts them. The fix advances over one escaped Unicode scalar before
continuing the existing scan. It does not add token codes, fields, exports, or
an alternative lexer. Existing STRING kind `25`, six-cell tape rows, byte spans,
and literal-source ownership remain unchanged. The proposed EQ kind `26` is
still unimplemented pending `bootstrap-token-helper-boundary.md`.

## RED to GREEN

Node `v22.14.0`, Windows x64 `10.0.26200.0`; native verification compiler SHA-256
`1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b`.
Compiled test producers read the source at runtime through stdin-provided
filenames. The compiler cannot fold the input tokenization ahead of execution.

```powershell
node --test --test-name-pattern='escaped quotes' tests/bootstrap/stage1-comment-token-producer.test.mjs
```

Before the four-line scanner fix: exit `1`, 0/1 passed, 937.7719 ms total;
the generated producer exited `3` instead of `0`. Native tokenization of the
same input succeeded. After the fix: exit `0`, 1/1 passed, 767.2892 ms total.
Token values and source locations are compared against the native lexer,
with source spans independently checked through the emitted tape rows.

The expanded focused suite passes 7/7. Additional cases cover 17 Unicode and
backslash-run boundaries, escaped comment markers, a following real comment,
EOF after a backslash, an escaped final quote, and the first string error
preceding a later malformed comment. Earlier comment regressions remain intact.

Malformed strings retain the tape's existing exact diagnostic:
`unterminated string literal`. Native's diagnostic is capitalized
`Unterminated string literal`; this packet neither changes nor normalizes that
existing difference and does not claim full diagnostic parity. Triple/raw
strings, full indentation handling, and all operator tokens remain outside
this verified slice. Uncaught native assertion text is still a separate gap.

## Regression gates

Use `VKF_NATIVE_BIN=build/native-windows/bin`,
`VKF_BUNDLE_ARTIFACT_TOOL=build/native-windows/bin/vkf_bootstrap_bundle_artifact_smoke.exe`,
and `VKF_TEST_WORK_ROOT=build/bootstrap-tests`. Set `TEMP` and `TMP` to that
same work root for the decimal fixture. Crash-capable runs inherit
`SetErrorMode(0x8003)`. Source hashes were refreshed by the established I94
LF-normalized SHA-256 recipe; only lexer and ordered-bundle values changed.

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-comment-token-producer.test.mjs tests/bootstrap/stage1-direct-decimal-parse.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage1-ast-to-ir-logical-chain.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle-unit.test.mjs tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

Exit `0`, **15/15 passed**, 29446.2443 ms total. Full bundle: 10713.027 ms;
source-graph materialization: 7446.0672 ms. All original timeouts and assertions
are unchanged. No performance claim follows from these timings.

A second isolated `stage1-bootstrap-executable-bundle.test.mjs` run passed 1/1:
10749.7391 ms test time, 10836.9881 ms total, under the unchanged 60000 ms
child-process deadline.

## Identities and acceptance boundary

SHA-256 of canonical LF source bytes:

- Lexer: `19be57aa68467221cd8ddd46c7a839585fb881b02415b375596726516c977a93`
- Manifest: `f84fdbacabbcf2d37a9332ab1dbf34ea140ec23b9ef22ab1c6cccf8364a77cad`
- Test: `ee6592ed3a62b7586b441b987d5be96da787b9fd70b25fe5eab0790fb1b69fd5`
- Ordered bundle: `af555c9aa8268be3084e7f4e37c636749b22be80149fe494bd3ac2a9fe66c873`

This packet advances an existing token behavior, not a complete self-hosted
compiler. The source-graph fixture still copies its executable and source
bytes, rather than compiling the compiler source into the next stage. No
ADR-0005 completion percentage is promoted. I240 still requires the missing
exact seed SHA `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`;
no replacement seed was used. Main and pre-gen were not edited or deployed.
