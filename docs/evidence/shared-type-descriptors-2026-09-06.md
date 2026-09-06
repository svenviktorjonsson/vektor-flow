# Shared WASM reflected type descriptors — 2026-09-06

- Artifact SHA-256: `9feccfa35ffebe005558bc226b6622a04e37bdbadbe79babc63ae01130ce8708`
- The compiler frontend's canonical reflected-type spelling is retained as a
  VM string. JavaScript transports only the compiler-formatted console text.
- Actual inline worker exact-output tests: 6/6, including unchanged
  `core/50-generic-types.vkf` and `core/49-nominal-constructors.vkf`.
- Documentation execution smoke: 58/87 (previous 55/87). This is not an
  acceptance percentage.
- Exact README/linked-guide acceptance: 7/87 (8.05%).
- Remaining reflection cluster REDs: nominal record display in
  `core/07-reflection.vkf`; multiset representation in
  `core/46-member-reflection.vkf`.

Full census: `shared-documentation-execution-type-descriptors-2026-09-06.json`.
