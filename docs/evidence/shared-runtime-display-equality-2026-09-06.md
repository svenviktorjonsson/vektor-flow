# Shared WASM runtime display and equality — 2026-09-06

- Artifact SHA-256: `b71aa9e81cfbb2982b2c906d7559a4860262181e769b699402b648db2ab8de81`.
- Unchanged README `core/03-blocks.vkf` now preserves the native inferred
  scope-identity constructor display: `make_base(x:3, y:4)`.
- Unchanged README `core/17-equality.vkf` now distinguishes structural
  `==`/`!=` reduction from elementwise `=` and preserves native numeric bit
  results: `1`, `1`, `[1, 1]`.
- `vkf_runtime_value_semantics.hpp` owns scope-identity display classification
  and aggregate comparison classification. WASM bytecode carries the selected
  constructor name and aggregate bit representation; JavaScript remains byte
  transport only.
- Native language suite: 451/451. Shared native/WASM parity: 329/451 with no
  regression. Documentation exact parity moves 63/87 to 65/87 (74.71%);
  execution smoke remains 68/87. Shared frontend/UI: 37/37. Execution/public
  boundary including both new tracers: 93/93. Inline-worker guard: 1/1.
  Production artifact imports: zero.
- No JavaScript language values, metadata replay, fallback, host import, or
  public compiler response change was introduced.

Full reports: `shared-documentation-exact-runtime-display-equality-2026-09-06.json`
and `native-wasm-suite-runtime-display-equality-2026-09-06.json`.
