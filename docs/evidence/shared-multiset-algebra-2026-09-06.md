# Shared WASM multiset algebra — 2026-09-06

- Artifact SHA-256: `2c954ba9cd4941e85bae281b4125fe0a7a5b205ab8022efd294c0c7b7d2b30d7`
- Compiler-private bytecode version 3 lowers multiset `+`, `-`, `//`, and `%`
  to one emitted-WASM operation. The emitted runtime aggregates equal keys,
  preserves first-seen key order, and applies native count semantics without
  JavaScript values, fallback execution, or metadata replay.
- Actual inline-worker exact-output tests: 10/10. The unchanged
  `core/14-multisets.vkf` example prints exactly
  `{a:7, b:1, c:2}\n{a:1, b:1}\n{a:2}\n{a:1}\n`.
- Native language suite: 451/451. Shared native/WASM parity: 297/451, versus the
  preserved 133/451 baseline; remaining 154 cases retain explicit diagnostics.
- Documentation execution smoke remains 61/87. Exact README/linked-guide
  acceptance moves from 10/87 to 11/87 (12.64%).

Full reports: `shared-documentation-execution-multiset-algebra-2026-09-06.json`
and `native-wasm-suite-multiset-algebra-2026-09-06.json`.
