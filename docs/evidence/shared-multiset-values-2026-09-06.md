# Shared WASM multiset values — 2026-09-06

- Artifact SHA-256: `f61f901b92e7edc27c37c6ac957c4cae9bdb6bf8d1190d81a5cdf6eb183a0af7`
- Compiler-private bytecode version 3 constructs multiset key/count entries in
  emitted WASM. The compiler stdout formatter renders their canonical braces;
  JavaScript receives only final console text.
- Actual inline worker exact-output tests: 8/8. Unchanged
  `core/46-member-reflection.vkf` matches native output, including
  `{x:1, y:1}`.
- Documentation execution smoke moves 58/87 to 60/87. This is not acceptance:
  `core/14-multisets.vkf` now reaches execution but multiset algebra remains an
  exact-output RED.
- Exact README/linked-guide acceptance moves from 8/87 to 9/87 (10.34%).

Full census: `shared-documentation-execution-multiset-2026-09-06.json`.
