# Shared WASM nominal display — 2026-09-06

- Artifact SHA-256: `40270ce0ddd69a1d042bb645102af15e829e8dcdecc875d4a9861865610136d3`
- `io.print` marks nominal arguments in compiler bytecode. Emitted WASM wraps
  only the captured output value with its compiler-owned nominal name; the
  underlying language value and program semantics remain unchanged.
- The compiler's stdout formatter consumes the private wrapper. JavaScript
  receives only final console text and never reconstructs a nominal value.
- Actual inline worker exact-output tests: 7/7. Unchanged
  `core/07-reflection.vkf` now matches native output, including
  `TypeScope(reflected:type)`.
- Documentation execution smoke remains 58/87; exact README/linked-guide
  acceptance moves from 7/87 to 8/87 (9.20%).
- Remaining reflection cluster RED: compiler-owned multiset execution/display
  in `core/46-member-reflection.vkf`.
