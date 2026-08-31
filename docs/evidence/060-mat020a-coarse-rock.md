# 060-MAT020A coarse rock geometry evidence

- Packet: `060-MAT020A`, 0.6 MAT-020
- Base: `4b41c56d08ed220efc7da6e0d000b350634c21d9`
- Branch: `codex/0.6/060-mat020a-coarse-rock`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal deterministic demand-refined geometry reference only; no VKF
  syntax, public package API, schema, runtime, renderer, or material hookup

## Internal behavior

- `createCoarseEllipsoidReference(radii)` builds a frozen anisotropic
  octahedral ellipsoid: six stable axis vertices and eight stable outward
  triangular faces.
- Vertex, edge, and face identities are deterministic strings derived from
  signed axes. Undirected edge IDs canonicalize their two endpoint IDs.
- `refineEllipsoidFaceReference(shape, faceId)` evaluates only one demanded
  coarse face. It projects that face's centroid onto the ellipsoid, adds one
  stable center vertex, and replaces the face with three stable child faces.
- Refinement deliberately leaves all three coarse boundary edges unchanged.
  Refined and unrefined neighbors therefore share exact vertex positions and
  edge IDs without cracks or transition geometry.
- Every result and nested record is frozen. No cache, mutable refinement tree,
  unrelated face traversal, or allocation proportional to unrealized detail
  exists.
- Radii must be exactly three finite positive values. Refinement accepts only
  module-created coarse shapes and their declared coarse face IDs.

## RED/GREEN slices

All focused cycles used
`node --test tests/js/vf-demand-refined-geometry.test.mjs`.

1. Closed coarse ellipsoid
   - RED: `vf-demand-refined-geometry.mjs` did not exist.
   - GREEN: six pinned vertices and eight outward faces form the requested
     anisotropic ellipsoid.
   - Commit: `6104d85 feat(geometry): add coarse ellipsoid tracer`
2. Radius validation
   - RED: malformed, non-finite, and non-positive radii were accepted.
   - GREEN: strict three-component positive finite validation.
   - Commit: `4d82553 fix(geometry): validate ellipsoid radii`
3. Coarse closure
   - GREEN characterization: all 12 canonical edges have incidence two,
     Euler characteristic is two, and every face has outward winding.
   - Commit: `7efcba8 test(geometry): prove coarse mesh closure`
4. Single demanded-face refinement
   - RED: the module had no refinement export.
   - GREEN: one face produces exactly one projected vertex and three child
     faces while every unrelated face remains byte-for-byte represented by its
     original immutable record.
   - Commit: `3250658 feat(geometry): refine one demanded face`
5. Refinement validation
   - RED: unknown, malformed, and already-refined IDs were not rejected by an
     explicit contract.
   - GREEN: only declared coarse faces on a module-created shape are accepted.
   - Commit: `d08d38c fix(geometry): validate face refinement`
6. Refined closure
   - GREEN characterization: the mixed-resolution mesh remains closed and
     outward, with every edge incident to exactly two faces.
   - Commit: `201f0bf test(geometry): prove refined mesh closure`
7. Demand independence
   - GREEN characterization: forward, reverse, and uneven 1/5/2 face chunks
     independently reproduce the same demanded result. Each demand generates
     exactly one target-prefixed vertex and three target-prefixed faces.
   - Commit: `38c7246 test(geometry): prove demand independence`
8. Shared boundaries
   - GREEN characterization: independently refining neighboring faces preserves
     their exact shared coarse boundary positions and canonical edge identity.
   - Commit: `43d100d test(geometry): pin shared face boundaries`

## Pinned topology and geometry oracles

- Radii `[3, 2, 1.5]` yield vertices
  `vertex:+x`, `vertex:-x`, `vertex:+y`, `vertex:-y`,
  `vertex:+z`, and `vertex:-z`.
- The coarse mesh has `V=6`, `E=12`, `F=8`, Euler characteristic `2`,
  and signed volume `12`.
- Refining `face:+x:+y:+z` adds
  `vertex:face:+x:+y:+z/refine:1/center` at
  `[1.7320508075688774, 1.1547005383792517, 0.8660254037844387]`.
- That projected point has ellipsoid residual
  `1.0000000000000002`.
- The mixed mesh has `V=7`, `E=15`, `F=10`, Euler characteristic `2`,
  signed volume `13.098076211353316`, and edge incidence two throughout.
- Its three original boundary IDs are preserved exactly while its three
  interior center edges are stable canonical IDs.

## Test receipts

- Focused command:
  `node --test tests/js/vf-demand-refined-geometry.test.mjs`
- Exit/duration: 0 after 141.72 ms; 8 tests passed.
- Full command: `npm test`
- Exit/duration: 1 after 11.63 s; 424 passed and 3 failed.
- Every MAT020A test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-demand-refined-geometry.mjs`,
  `tests/js/vf-demand-refined-geometry.test.mjs`, and this receipt.
- SHA-256:
  - module: `64a1e66df3bdef8e32365cfaca36b79b4110fdf75447d3bdf4a9a10caf0fccbd`
  - tests: `f388f48349c753d164ae967fedf182818c42bc833538573a9b77167b1f2ff94e`
- Git blobs:
  - module: `698077001f1a4a98e92b9974274a5f79beaf50b0`
  - tests: `52e670f6799f461e0bebccebd145ef224979052a`
- Recovery: both entry points remain internal and unwired. Reverting this
  packet cannot alter current rendering, materials, runtime, or VKF behavior.
