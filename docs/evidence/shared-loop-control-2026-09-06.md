# Shared WASM loop control — 2026-09-06

- Artifact SHA-256: `e4b18b4a80d479927d11bc746054d236391f2aa8e8ceb7cc4ab2b028a65e1293`.
- Exact actual-worker/native documentation parity moves from 58/87 to 59/87
  (67.82%); execution smoke moves from 64/87 to 65/87.
- The unchanged `core/33-loops.vkf` example is newly exact. Actual
  inline-worker exact-output tests are 16/16.
- Compiler-private lowering owns nested loop targets. `continue` branches jump
  to the match discriminant and `break` branches jump to its continuation;
  balanced stack values are discarded before each backedge. JavaScript remains
  transport-only with no fallback or metadata replay. The artifact has zero
  host imports.
- Native language suite: 451/451. Shared native/WASM parity remains 309/451;
  remaining 142 cases retain explicit diagnostics. Shared frontend/UI gates
  remain 37/37 and execution/boundary gates remain 91/91.

Full reports: `shared-documentation-exact-loop-control-2026-09-06.json` and
`native-wasm-suite-loop-control-2026-09-06.json`.
