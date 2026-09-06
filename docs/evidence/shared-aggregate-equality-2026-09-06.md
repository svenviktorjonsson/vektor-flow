# Shared WASM aggregate value equality — 2026-09-06

- Artifact SHA-256: `16cf2878ff2ffa8738a2533b343551d296d807fa1e8bfde2da73a2c5ba110a6f`.
- Public actual-worker tracer changed from two false pointer comparisons to
  exact native `ok`: heterogeneous and reflected record selectors retain their
  authored tuple values.
- Compiler-owned runtime equality now recursively compares Array and Tuple
  lengths and elements. Existing null, number, bit, and UTF-8 semantics remain
  unchanged; nested resources are compared as values, not allocation identity.
- Native language suite: 451/451. Shared native/WASM parity moves from 324/451
  to 329/451 with no regression. Newly exact cases cover heterogeneous,
  reflected, and repeated selectors, aggregate resource equality, and indexed
  assignment pipe equality.
- Documentation exact parity remains 63/87 (72.41%); execution smoke remains
  68/87. Shared frontend/UI: 37/37; execution/public-boundary: 91/91.
  Production artifact imports: zero.
- No JavaScript language values, metadata replay, fallback simulation, host
  import, or public compiler response change was introduced.

Full reports: `shared-documentation-exact-aggregate-equality-2026-09-06.json`
and `native-wasm-suite-aggregate-equality-2026-09-06.json`.
