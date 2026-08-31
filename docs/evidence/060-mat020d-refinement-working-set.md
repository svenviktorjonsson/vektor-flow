# 060-MAT020D refinement working-set evidence

- Packet: `060-MAT020D`, 0.6 MAT-020
- Base: `46e1f25b1ca65a6208637ab6995b26c7f0183fac`
- Branch: `codex/0.6/060-mat020d-refinement-working-set`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal deterministic refinement working-set reference only; no VKF
  syntax, public package API, schema, runtime, renderer, or material hookup

## Internal behavior

- `updateEllipsoidRefinementWorkingSetReference` accepts the immutable coarse
  ellipsoid, an optional predecessor state, active stable face-demand records,
  and explicit non-negative safe-integer vertex and face budgets.
- Demand order is canonicalized by silhouette status, silhouette error,
  projected error, conservative error bound, then binary face ID.
- Each retained coarse-face refinement costs exactly one generated vertex and
  three generated faces. Capacity is
  `min(vertexBudget, floor(faceBudget / 3))`.
- Selected predecessor entries retain object identity. Detail absent from the
  next selected set is evicted completely. A later request regenerates the
  same frozen vertex and face payload by invoking the stable face key against
  the unchanged coarse shape.
- The state retains no tombstone detail or history population. Its entry array
  contains only currently selected refinements; empty demand produces empty
  usage and entries.
- Every state keeps the original coarse object by identity. Coarse vertex and
  face arrays are never copied, replaced, or mutated.
- Duplicate, unavailable, malformed, or non-finite demand priorities,
  malformed budgets, foreign predecessors, and cross-shape predecessors fail
  before detail generation.

## RED/GREEN slices

All focused cycles used
`node --test tests/js/vf-refinement-working-set.test.mjs`.

1. Bounded priority working set
   - RED: `vf-refinement-working-set.mjs` did not exist.
   - GREEN: dual budgets retained the two highest-priority silhouette
     refinements using exactly two vertices and six generated faces.
   - Commit: `99397dd feat(geometry): bound refinement working set`
2. Retained steady state
   - RED: repeated unchanged demand regenerated every entry and reported all
     entries as newly created.
   - GREEN: selected predecessor entries retain object identity and the change
     ledger reports no creation or eviction.
   - Commit: `2ae298e feat(geometry): retain steady detail`
3. Exact key regeneration
   - GREEN characterization: a completely changed demand set evicts the first
     details; returning later regenerates byte-identical vertex/face records
     from the original stable face keys.
   - Commit: `62fbeaf test(geometry): prove detail regeneration`
4. Traversal independence
   - RED: duplicate face demands could occupy budget more than once.
   - GREEN: forward, reverse, and uneven flattened chunks select identical
     states; duplicate and foreign keys fail.
   - Commit: `9529ca6 fix(geometry): stabilize demand traversal`
5. Validation and ownership
   - RED: negative/fractional budgets, malformed priority fields, and foreign
     predecessor states reached selection arithmetic.
   - GREEN: shape, budgets, all priority lanes, state provenance, and coarse
     ownership are validated before generation.
   - Commit: `56e2441 fix(geometry): validate refinement cache`
6. Camera-change steady state
   - GREEN characterization: real positive-X and negative-X MAT020C view
     demands replace one another under a two-vertex/six-face cap; repeating
     the new view has no cache churn and returning regenerates exact detail.
   - Commit: `9bf703a test(geometry): prove camera cache steady state`
7. Memory budget sweep
   - GREEN characterization: all 225 combinations of vertex budgets 0–8 and
     face budgets 0–24 respect both caps. Empty active demand evicts all eight
     possible refinements and reports zero usage.
   - Commit: `01d196f test(geometry): sweep refinement budgets`

## Pinned working-set oracles

- Under vertex budget 2 and face budget 6, silhouette demands with measured
  errors 40 and 20 outrank non-silhouette demands with errors 200 and 100.
- The resulting usage is exactly `{ vertices: 2, faces: 6 }`.
- An unchanged update reports the two face IDs in `retained`, with empty
  `created` and `evicted` arrays, and reuses both entry objects.
- Replacing positive-X view demand with negative-X view demand reports two new
  negative-X faces and the two positive-X faces as evicted.
- Repeating the negative-X view reuses both entries. Returning to positive-X
  yields detail deeply equal to its first materialization but with newly
  generated entry objects.
- Starting with all eight refinements and updating with no demands produces
  zero vertices, zero faces, no entries, and eight stable evicted IDs.

## Test receipts

- Focused combined command:
  `node --test tests/js/vf-demand-refined-geometry.test.mjs tests/js/vf-ellipsoid-view-demand.test.mjs tests/js/vf-refinement-working-set.test.mjs`
- Exit/duration: 0 after 341.39 ms; 26 tests passed.
- Working-set-only tests: 7 passed.
- Full command: `npm test`
- Exit/duration: 1 after 11.96 s; 442 passed and 3 failed.
- Every MAT020A/B/C/D test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-refinement-working-set.mjs`,
  `tests/js/vf-refinement-working-set.test.mjs`, and this receipt.
- SHA-256:
  - module: `5d1cf833ab3c99c6c75414423282e92621de72b9c7f7fb0c77005b0e20956629`
  - tests: `c2b6dfd09c544ea39505c43be150511e411d5dd4f2111d0b1858e629cb560867`
- Git blobs:
  - module: `4e0d1c2781540c9639b3b1e7236965c32181687a`
  - tests: `17c2a60870e4cbdafd6a29caec3785068edfe499`
- Recovery: the working set remains internal and unwired. Reverting this
  packet cannot alter current rendering, materials, runtime, memory policy, or
  VKF behavior.
