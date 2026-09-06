# Shared WASM runtime value semantics — 2026-09-06

- Artifact SHA-256: `1459492d21e99c7285a6446db568c7d74bd74a3a101b8fd87f5a378125423fe6`.
- The unchanged `core/08-strings.vkf` README source now executes through the
  actual inline worker with exact native five-line output.
- `vkf_runtime_value_semantics.hpp` owns target-neutral display-family,
  numeric-format, and ordered record-field plans. The WASM lowering adapter
  evaluates each interpolation operand in source order and materializes UTF-8
  strings inside emitted WASM for text, boolean, number, fixed `.2f`, and
  nested record values.
- No JavaScript language values, metadata replay, fallback, host import, or
  public compiler response change was introduced.
- Public actual-worker tracers: 21/21. Native language suite: 451/451. Shared
  native/WASM parity moves from 316/451 to 318/451; newly exact cases are
  `string_interpolation_paths_and_expressions` and
  `string_interpolation_formats_numbers`.
- Documentation exact parity moves from 62/87 to 63/87 (72.41%); execution
  smoke moves from 67/87 to 68/87. Shared frontend/UI: 37/37;
  execution/public-boundary: 91/91. Production artifact imports: zero.

Full reports: `shared-documentation-exact-runtime-value-semantics-2026-09-06.json`
and `native-wasm-suite-runtime-value-semantics-2026-09-06.json`.
