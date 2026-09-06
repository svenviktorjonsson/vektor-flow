# Shared WASM reachable-program slice

Date: 2026-09-06

Base: `ef4122f3 feat(web): run guide source with shared WASM`

The emitted browser program now retains only source functions reachable from
top-level execution. Reachability follows compiler-owned typed-IR `load` nodes
transitively; it does not inspect source text or execute metadata. This prevents
an unused function such as `random.clock_seed` from forcing forbidden clock
capabilities into an otherwise pure explicit-seed program.

The existing numeric `int` conversion is lowered with an exact integer check:
the original numeric value is retained only when floor-division by one compares
equal, otherwise the program traps. No host capability or JavaScript conversion
was added.

## RED to GREEN

The unchanged `stdlib/03-random.vkf` guide example initially failed while
lowering unreachable `time.wall_seconds`. After reachability pruning it reached
the called `next` function, exposing missing `int` lowering. With both compiler
steps complete, the actual production worker emits exactly:

```text
0.009626434189093501
1.791479416094478
```

The focused test is 1/1. The deployed shared artifact is import-free and its
SHA-256 is `83cd38a905dae1e80120fb900270637e310f406c4813b21ab8bc3b694c11258a`.

## Full census

The 87-source execution smoke moved from 47/87 to 52/87, a five-source gain.
Besides the exact random example, eager-lowering failures disappeared from the
linalg example and three symbolic examples. This smoke is not acceptance: it
does not independently verify exact output, edits, or reset. Exact production
worker acceptance is 2/87 examples (2.30%). The complete per-source result is
`shared-documentation-execution-reachable-2026-09-06.json`.
