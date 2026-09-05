# Locked-source tokenization inventory

Read-only compiler audit at bootstrap
`b17c2c2e20ead910c987e54d5434fc3a7b9395e3` on Windows x64, Node 22.14.0.
No compiler, manifest, token code, public diagnostic, or acceptance gate changed.

## Reproduction and scope

Run `node tools/audit-bootstrap-token-inputs.mjs --localize` with
`VKF_NATIVE_BIN` pointing to `build/native-windows/bin`. The tool compiles one
runtime-input probe with `--optimizer-policy mask-0`, verifies each locked
source's canonical-LF SHA, and supplies its complete bytes to the native lexer
and existing `tagged_numeric_function_token_tape` producer. Build artifacts
stay under this checkout's `build/bootstrap-token-inventory`.

The initial whole-source run took 5.285 seconds. Localization was a separate
run. Its prefixes always start at byte zero: no unsupported character or
earlier source is removed. A first matching prefix only localizes the observed
whole-source error; it is not a replacement acceptance input. Both runs kept
the original 30-second compile and 3-second per-execution bounds.

| Input identity | SHA-256 |
| --- | --- |
| Locked bundle | `af555c9aa8268be3084e7f4e37c636749b22be80149fe494bd3ac2a9fe66c873` |
| Native compiler | `1d2d8e9bd9f2e8b0f4320f653ed862ad77d2a689144b3e812c66d6e45130c41b` |
| Generated probe source | `31eb8794db4a91668a3ec13a2783cc03dea4293bd6905916161b45b092899208` |
| Generated probe executable | `919e8a6066031441907bcb1b134da00190e4a6f89bfa13bc4c3db6d1c2961743` |

## Observations

Every listed complete source was accepted by the native lexer with exit 0 and
empty stderr. The producer's caught-error wrapper also exits 0, but emits the
following exact failure where marked: `function token tape encountered
unsupported punctuation\r\n`. That wrapper exit is **not** tokenization success.

Paths below are relative to `compiler/self_hosted/`.

| Whole source | First matching prefix line | First rejected construct on that line |
| --- | ---: | --- |
| `lexer.vkf` | 29 | `=` in `cursor.peek() = "\n"?` |
| `parser.vkf` | 154 | `=` in `peek_kind(cursor) = "EOF"` |
| `typed_ir.vkf` | 144 | `=` in `(kind = "nested_addition")?! ...` |
| `machine_ir.vkf` | 112 | `=` in `provided_parameter_mask:num=0` |
| `machine_ir_validation.vkf` | 6 | `=` in `argument_count:num=0` |
| `compiler.vkf` | 16 | `!` in `comment_only?! ...` |
| `pe_x64.vkf` | 4 | Existing native `<=` composite operator |
| `native_scene_compiler.vkf` | 46 | `&` after `"sessions/"` |
| `stdlib/math.vkf` | 37 | Existing native `/\` composite operator |
| `stdlib.vkf` | Not applicable | No caught error; stdout exactly `\r\n` |
| `stdlib/io.vkf` | Not applicable | No caught error; stdout exactly `\r\n` |

No-error observations do not prove token kind, span, value, layout, parser,
typed-IR, or artifact parity. This inventory intentionally does not turn source
counts into progress percentages. It does not bypass the EQ/helper-ABI decision
or remove the independent missing I240 seed and compiler self-copy blockers.

## Independent boundary candidate, not yet a reproduced RED

`native_scene_compiler.vkf:41` contains a triple-double-quoted docstring before
its first reported punctuation failure. Code inspection shows that native
`scan_double_string` recognizes triple delimiters and emits one `STRING`.
The private `_scan_tagged_function_string` recognizes a single closing quote;
its current caller advances past only one opening quote. It therefore appears
to divide a simple triple-quoted literal into three existing STRING25 spans.

The next bounded test can compare that actual docstring's runtime-input span
and following token position with the native oracle. This needs no new numeric
token code. No such RED or fix is claimed here. A span fix alone would not prove
decoded-value/dedent parity: native string decoding and browser consumers that
strip one quote must be audited separately. Existing malformed-string wording
must not be silently changed to obtain apparent parity.
