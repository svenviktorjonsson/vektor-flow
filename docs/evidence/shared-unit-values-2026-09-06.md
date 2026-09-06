# Shared WASM dimensioned unit values — 2026-09-06

- Artifact SHA-256: `91d6514a79c6e1f926b94550df9928b212025905c62f14ec7368c1125f35da4d`
- The frontend remains authoritative for unit dimensions and scale. Emitted
  WASM represents the already-typed `unit<...>` and `quantity<...>` values as
  numbers and executes their arithmetic directly; JavaScript only transports
  compiler-formatted console text.
- Actual inline worker exact-output tests: 9/9. The unchanged linked-guide
  physics example prints exactly `6\n[0, 0, 1]\n`.
- Documentation execution smoke moves 60/87 to 61/87. Exact README/linked-guide
  acceptance moves from 9/87 to 10/87 (11.49%).

Full census: `shared-documentation-execution-units-2026-09-06.json`.
