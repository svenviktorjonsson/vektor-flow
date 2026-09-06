# Shared WASM pipe shapes — 2026-09-06

- Artifact SHA-256: `a11562edfa169aadd8a4fd3be208542801fd458d36187d7f95466b129bedc820`.
- The exact documentation census now invokes the same native compiler for each
  of the 87 unique published sources and compares its console bytes with the
  actual inline-worker/shared-WASM result. Exact parity moves from 52/87 to
  55/87 (63.22%); execution smoke remains 61/87.
- The three newly exact unchanged examples are `core/22b-literal-spreads.vkf`,
  `core/35-pipes.vkf`, and `core/36b-pipe-assignment.vkf`.
- Emitted WASM now executes scalar pipes once, walks UTF-8 string pipes by
  compiler-owned byte cursors, preserves tuple tags for runtime-sized pipe
  results, and gives a flattened mixed literal spread its canonical list tag.
  JavaScript remains transport-only; there is no fallback or metadata replay.
- Actual inline-worker exact-output tests: 12/12. Native language suite:
  451/451. Shared native/WASM parity: 302/451, up from 297/451; remaining 149
  cases retain explicit diagnostics.

Full reports: `shared-documentation-exact-pipes-2026-09-06.json` and
`native-wasm-suite-pipes-2026-09-06.json`.
