# Shared WASM type patterns — 2026-09-06

- Artifact SHA-256: `eac0b12249735ecf51422dffea17e937627a743f03dc38152a4de655d5dcda46`.
- Exact actual-worker/native documentation parity moves from 57/87 to 58/87
  (66.67%); execution smoke moves from 63/87 to 64/87.
- The unchanged `core/32-match.vkf` example is newly exact. Actual
  inline-worker exact-output tests are 15/15.
- The typed frontend descriptor now selects compiler-owned predicates for
  exact, numeric, union, intersection, record, and tuple type-pattern arms.
  The emitted WASM executes that predicate; JavaScript remains transport-only
  with no fallback or metadata replay. The artifact has zero host imports.
- Native language suite: 451/451. Shared native/WASM parity: 309/451, up from
  307/451; remaining 142 cases retain explicit diagnostics. Shared frontend/UI
  gates remain 37/37 and execution/boundary gates remain 91/91.

Full reports: `shared-documentation-exact-type-patterns-2026-09-06.json` and
`native-wasm-suite-type-patterns-2026-09-06.json`.
