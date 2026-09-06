# Shared WASM alias ownership — 2026-09-06

- Artifact SHA-256: `d033f8ead9bb71dcd04b523235b401fa69635af039a8d299997c1fbaef0dbc26`.
- Exact actual-worker/native documentation parity moves from 59/87 to 60/87
  (68.97%); execution smoke remains 65/87.
- The unchanged `core/13-updates-aliases.vkf` example is newly exact. Actual
  inline-worker exact-output tests are 17/17.
- Compiler-private lowering mutates equal-sized compound array updates in
  place, preserving aliases. Size-changing dynamic updates rebind storage.
  JavaScript remains transport-only; no fallback or metadata replay. Artifact
  has zero host imports.
- Native language suite: 451/451. Shared native/WASM parity remains 309/451;
  remaining 142 cases retain explicit diagnostics. Shared frontend/UI gates
  remain 37/37 and execution/boundary gates remain 91/91.

Full reports: `shared-documentation-exact-alias-ownership-2026-09-06.json` and
`native-wasm-suite-alias-ownership-2026-09-06.json`.
