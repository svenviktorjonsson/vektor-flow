# Shared WASM error catches — 2026-09-06

- Artifact SHA-256: `1f9f6e90736bfbd7b582191bd4ca5ec1614641809820be70800439a43d51a59e`.
- Exact actual-worker/native documentation parity moves from 55/87 to 57/87
  (65.52%); execution smoke moves from 61/87 to 63/87.
- The unchanged `core/34-errors.vkf` and `stdlib/07-errors.vkf` examples are
  newly exact. Actual inline-worker exact-output tests are 14/14.
- The frontend's error masks remain authoritative. Compiler-private bytecode
  matches the emitted error-mask value in WASM, including hierarchy bits, and
  binds the caught error record for the selected arm. Explicit raises and the
  documented literal fractional-`int` conversion execute through this path.
  General dynamic error propagation remains outside this bounded packet.
- JavaScript transports only the compiler result; it does not catch, classify,
  replay, or simulate errors. The artifact has zero host imports.
- Native language suite: 451/451. Shared native/WASM parity: 307/451, up from
  302/451; remaining 144 cases retain explicit diagnostics.

Full reports: `shared-documentation-exact-errors-2026-09-06.json` and
`native-wasm-suite-errors-2026-09-06.json`.
