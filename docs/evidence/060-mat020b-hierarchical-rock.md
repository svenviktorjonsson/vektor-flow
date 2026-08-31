# 060-MAT020B hierarchical rock geometry evidence

- Packet: `060-MAT020B`, 0.6 MAT-020
- Base: `fd86d6dedd8220508e184f0ad57b70112744de07`
- Branch: `codex/0.6/060-mat020b-hierarchical-rock`
- Environment: Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal deterministic second-level geometry reference only; no VKF
  syntax, public package API, schema, runtime, renderer, or material hookup

## Internal behavior

- `refineEllipsoidChildFaceReference(levelOneShape, childFaceId)` refines one
  demanded level-one triangle into four stable level-two triangles.
- Its three edge midpoints are projected radially onto the anisotropic
  ellipsoid. Midpoint IDs derive from canonical shared-edge identity, so either
  neighboring demand independently derives the same ID and exact position.
- Each of the three immediate edge neighbors is split into two deterministic
  conformity faces. This is the complete and minimal one-ring repair: the
  demanded face and three neighbors are replaced while all six unrelated faces
  remain their original immutable records.
- Work evidence is fixed per demand at three generated vertices, four demanded
  children, and six conformity children. No unrelated geometry receives detail.
- Only module-created level-one shapes and their declared child IDs are
  accepted. The packet deliberately caps refinement at the additional second
  level.

## RED/GREEN slices

All focused cycles used
`node --test tests/js/vf-demand-refined-geometry.test.mjs`.

1. Hierarchical refinement and conformity ring
   - RED: the module did not export
     `refineEllipsoidChildFaceReference`.
   - GREEN: one demanded child produced three stable edge midpoints, four
     hierarchical children, and exactly three two-face neighbor repairs.
   - Commit: `49c9f0f feat(geometry): refine hierarchical faces`
2. Mixed-level closure
   - GREEN characterization: exact projected coordinates, outward winding,
     edge incidence two, Euler characteristic two, and unchanged unrelated
     face records.
   - Commit: `5b27a36 test(geometry): prove mixed-level closure`
3. Refinement-depth validation
   - RED: a generated level-two child could be refined a third time even
     though this packet owns only one additional level.
   - GREEN: the entry point accepts only a level-one child on its owning shape.
   - Commit: `bf8b7f0 fix(geometry): bound refinement depth`
4. Demand and work independence
   - GREEN characterization: all 24 level-one child identities reproduce
     exactly under forward, reverse, and uneven 2/13/9 chunks. Each demand has
     the same bounded work ledger and preserves exactly six unrelated faces.
   - Commit: `3ca4fbe test(geometry): prove bounded face demand`
5. Shared hierarchical identity
   - GREEN characterization: independently demanding neighboring children
     derives the same shared-edge midpoint ID and exact coordinates.
   - Commit: `67ed1e5 test(geometry): pin shared midpoint identity`

## Pinned topology and geometry oracles

- Refining `face:+x:+y:+z/refine:1/child:0` adds midpoint positions:
  - `[2.1213203435596424, 1.414213562373095, 0]`
  - `[0.9751727510156044, 1.7761476679542303, 0.4875863755078022]`
  - `[2.6642215019313458, 0.6501151673437363, 0.4875863755078022]`
- Every new vertex satisfies the ellipsoid equation within `1e-15`.
- The mixed-level mesh has `V=10`, `E=24`, `F=16`, Euler characteristic
  `2`, and signed volume `14.423964731154435`.
- Every edge has incidence two and every triangle has positive outward
  orientation.
- Each split parent edge disappears from the final incidence map and is
  replaced by two exact subedges, each shared by the demanded and conformity
  sides.
- The shared sibling midpoint is
  `vertex:midpoint:2:edge:vertex:+y|vertex:face:+x:+y:+z/refine:1/center`
  at
  `[0.9751727510156044, 1.7761476679542303, 0.4875863755078022]`.

## Test receipts

- Focused command:
  `node --test tests/js/vf-demand-refined-geometry.test.mjs`
- Exit/duration: 0 after 213.11 ms; 13 tests passed.
- Full command: `npm test`
- Exit/duration: 1 after 15.95 s; 429 passed and 3 failed.
- Every MAT020A/B test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/vf-demand-refined-geometry.mjs`,
  `tests/js/vf-demand-refined-geometry.test.mjs`, and this receipt.
- SHA-256:
  - module: `35e531c4410fea342654d5b5382378102c11fff6ef3b136f268a9f8a662ece8b`
  - tests: `129bdeacc3f011475dd26f3a299d8a32df0fe7d07716dae062acf3deb4651fc6`
- Git blobs:
  - module: `61cee966f4fe96b3e017b1e3afd51eeb3d53d726`
  - tests: `f0e329e993d53d523f541b753e2f703341d87005`
- Recovery: the second-level entry point remains internal and unwired.
  Reverting this packet cannot alter current rendering, materials, runtime, or
  VKF behavior.
