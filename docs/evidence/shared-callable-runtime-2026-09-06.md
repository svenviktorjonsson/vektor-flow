# Shared WASM callable runtime — 2026-09-06

- Artifact SHA-256: `cdabe0e5bfe40c2cbddda22a5faa27919437534cdb358ec635930645c9a5c8c9`.
- Unchanged README `core/20-recursion-closures.vkf` now executes recursive
  factorial and a captured returned callable with exact native output.
- Unchanged README `core/21-lambdas.vkf` now executes higher-order parameters,
  stored lambdas, and immediate lambdas with exact native output.
- The browser compiler now feeds prepared typed IR through the same canonical
  stored-closure and immediate/higher-order specialization used by native
  Machine IR before WASM reachability. No target-specific callable evaluator
  or JavaScript language value was added.
- Native language suite: 451/451. Shared native/WASM parity moves 329/451 to
  340/451 with no regression. Documentation exact parity moves 65/87 to 67/87
  (77.01%); execution smoke moves 68/87 to 70/87. Shared frontend/UI: 37/37.
  Execution/public boundary including all public tracers: 95/95. Inline-worker
  guard: 1/1. Production artifact imports: zero.
- No metadata replay, fallback, host import, network, filesystem, process, DOM,
  or public compiler response change was introduced.

Full reports: `shared-documentation-exact-callables-2026-09-06.json` and
`native-wasm-suite-callables-2026-09-06.json`.
