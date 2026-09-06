# Shared WASM pipe/range control and arena capacity — 2026-09-06

- Artifact SHA-256: `fbd9aab587b0bb39bf7e273a2540f557391d736e964a537f28f471aa2d8e9e5e`.
- Exact actual-worker/native documentation parity moves from 61/87 to 62/87
  (71.26%); execution smoke moves from 66/87 to 67/87.
- The unchanged `core/36-pipe-blocks.vkf` example is newly exact. The public
  actual-worker tracer suite is 19/19.
- Shared native/WASM parity moves from 313/451 to 316/451. Newly exact tests
  cover string-pipe `break`, pipe-local `return`, and infinite-range `break`.
- Pipe control is compiler-owned in typed-IR-to-bytecode lowering. JavaScript
  remains transport-only; there is no fallback, metadata replay, or host import.
- The canonical emitter default now matches the explicit native-artifact arena:
  64 MiB. The top-level allocation policy guard is 1/1 and proves identical
  two-MiB request behavior, exact capacity, and zero imports for both paths.
- Native language suite: 451/451; shared frontend/UI: 37/37;
  execution/public-boundary: 91/91. Production artifact imports: zero.

Full reports: `shared-documentation-exact-pipe-range-capacity-2026-09-06.json`
and `native-wasm-suite-pipe-range-capacity-2026-09-06.json`.
