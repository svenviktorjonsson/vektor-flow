# Shared WASM flat gather/scatter indexing

Date: 2026-09-06

Base: `34d7a902 feat(wasm): execute fixed literal spreads`

The compiler now distinguishes one-dimensional multi-index selection from
nested coordinate indexing using canonical typed-IR shape. Flat reads gather
selected lanes into one owned array. Flat updates evaluate indices and the
aggregate right-hand side once, then scatter matching lanes. Nested array
pointer traversal remains unchanged.

An initially broad branch made the exact indexing example pass but regressed
the linalg example to a runtime trap. Narrowing gather to a one-dimensional
base and scatter to an aggregate right-hand side restored linalg before commit.

The unchanged `core/41-indexing.vkf` example runs through the production worker
with exact stdout `20\n[10, 30]\n[10, 21, 30, 41]\n`. Focused worker tests are
4/4. Full execution smoke moves 54/87 to 55/87 with no lost source. Exact
production-worker acceptance moves 4/87 to 5/87 (5.75%). Deployed artifact
SHA-256: `3d4c2086607cbd02de8b8692a63f035350446387bafb20d6a306283de4ed39a7`.
