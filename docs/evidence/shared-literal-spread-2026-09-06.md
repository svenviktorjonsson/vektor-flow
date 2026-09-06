# Shared WASM fixed literal spread

Date: 2026-09-06

Base: `836b6e11 feat(wasm): execute primitive guide conversions`

The compiler now expands typed-IR `spread` items whose owned value is a fixed
list or tuple while lowering a list/tuple literal. Children execute once in
authored order; JavaScript does not inspect or flatten values. Other spread
shapes retain an explicit unsupported diagnostic.

The unchanged `core/22b-literal-spreads.vkf` example runs through the actual
production worker and emits exactly `(1, 2, 3, 4)\n4\n`. Focused worker tests
are 3/3. Full execution smoke moves 53/87 to 54/87. Exact production-worker
acceptance moves 3/87 to 4/87 (4.60%). The deployed import-free artifact hash is
`c0ec91ba832d673e5e3a758792a8bd2ba74323961ea0187fdea9abfebf7855a6`.
