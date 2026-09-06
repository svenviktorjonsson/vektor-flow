# Shared WASM multidimensional indexing — 2026-09-06

- Artifact SHA-256: `35f0df336d4ba670b943a75e765aedffeaffe6ac71bf056df475fa2e7d5b4d05`.
- Exact actual-worker/native documentation parity moves from 60/87 to 61/87
  (70.11%); execution smoke moves from 65/87 to 66/87.
- The unchanged `core/11b-multidimensional-indexing.vkf` example is newly
  exact. Actual inline-worker exact-output tests are 18/18.
- Compiler-private lowering expands frontend-owned fixed spread indices and
  materializes fixed-shape broadcast gathers in emitted WASM. JavaScript stays
  transport-only; no fallback or metadata replay. Artifact has zero imports.
- Native language suite: 451/451. Shared native/WASM parity moves from 309/451
  to 313/451; remaining 138 cases retain explicit diagnostics. Shared
  frontend/UI gates remain 37/37; execution/boundary gates remain 91/91.

Full reports: `shared-documentation-exact-multidimensional-indexing-2026-09-06.json`
and `native-wasm-suite-multidimensional-indexing-2026-09-06.json`.
