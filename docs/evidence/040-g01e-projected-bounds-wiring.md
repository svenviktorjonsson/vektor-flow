# 040-G01E projected-bounds renderer wiring evidence

Recorded: 2026-08-31 09:12:03 +02:00

## Packet identity

- Packet: `040-G01E`, 0.4 GFX-040 Gate 3
- Base: `06d18da84aa38cbd13b3d821593cbef2ef906496`
- Implementation head before this receipt:
  `3b50aaff06643aca32837e18f82f8868f4b5f12d`
- Implementation tree before this receipt:
  `bb6f946c50ce06af5ff1568b5fb04fae79efc264`
- Branch: `codex/0.4/040-g01e-projected-bounds-wiring`
- Environment: Microsoft Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: internal renderer consumption of projected light bounds; no public VKF
  API and no shader semantic changes

## Slice 1: bounded point lights

- RED command: `node --test tests/js/vf-geom-clustered-light-wiring.test.mjs`
- RED exit/duration: 1 after 0.28 s; 2 passed and 1 failed
- RED result: the off-frustum point still produced full-frustum coverage, with
  64 assignments instead of 8
- GREEN affected command: `node --test tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-clustered-light-view-plan.test.mjs tests/js/vf-light-view-bounds.test.mjs`
- GREEN exit/duration: 0 after 0.33 s; 17 tests passed
- Commit: `74825a5 feat(renderer): project clustered point bounds`

The renderer now loads both internal planner entry points, translates renderer
light records to view-planner records, and keeps numeric planner IDs equal to
the original packed-light record index. The visible record kept ID `0`; the
off-camera record ID `1` produced no assignment.

## Slice 2: spot lights and near-plane retention

- RED command: `node --test tests/js/vf-geom-clustered-light-wiring.test.mjs`
- RED exit/duration: 1 after 0.32 s; 3 passed and 1 failed
- RED result: the unadapted spot caused conservative fallback, so the outside
  spot was not culled
- GREEN exit/duration: 0 after 0.40 s; 18 focused tests passed
- Commit: `4825b38 feat(renderer): project clustered spot bounds`

Finite spot position, direction, range, and outer-cone cosine now reach the
view planner. A point envelope intersecting the near plane remains assigned
while a separate off-camera spot is culled, and total assignments are below
the former 96 full-frustum assignments.

## Slice 3: projected aperture volumes

- RED command: `node --test tests/js/vf-geom-clustered-light-wiring.test.mjs`
- RED exit/duration: 1 after 0.29 s; 4 passed and 1 failed
- RED result: projected lights still selected conservative fallback, leaving
  the outside aperture light unculled
- GREEN exit/duration: 0 after 0.31 s; 5 wiring tests passed
- Commit: `8c61cfe feat(renderer): bound projected aperture lights`

The adapter reconstructs finite world-space aperture corners, includes the
source, and follows each aperture ray to its finite authored range. Those
points form the conservative geometry envelope consumed by
`planViewClusteredLights`. A narrow on-camera aperture retains assignments; an
equivalent aperture translated outside the camera produces none.

## Slice 4: exact live camera seams

- RED command: `node --test tests/js/vf-geom-projected-bounds-seams.test.cjs`
- RED exit/duration: 1 after 0.24 s; the renderer still planned from the old
  one-argument batch and single-scene call sites
- GREEN focused command: `node --test tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-projected-bounds-seams.test.cjs tests/js/vf-clustered-light-view-plan.test.mjs tests/js/vf-light-view-bounds.test.mjs`
- GREEN exit/duration: 0 after 0.38 s; 21 tests passed
- Affected command: `node --test tests/js/vf-geom-projected-bounds-seams.test.cjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-clustered-light-shader.test.mjs tests/js/vf-clustered-light-plan.test.mjs tests/js/vf-clustered-light-view-plan.test.mjs tests/js/vf-light-view-bounds.test.mjs tests/js/vf-geom-render-evidence.test.cjs tests/js/vf-gpu-runtime.test.cjs`
- Affected exit/duration: 0 after 1.20 s; 34 tests passed
- Commit: `3b50aaf feat(renderer): wire projected light cameras`

The single-scene path passes the already-computed `viewMat` and `projMat` used
for that draw. The batch path constructs the same Float32 view/projection
matrices as its shared scene camera and passes them to shadow preparation and
planning. The camera packet uses the cluster grid's positive near/far depths,
matching the existing WGSL receiver-index convention.

Batch projection is enabled only when every visible lit part shares one 3D
camera. Screen surfaces, per-part cameras, 2D parts, missing view-planner
capability, invalid camera matrices, invalid finite envelopes, and range-zero
unbounded lights retain deterministic full-frustum coverage. The fallback test
proves the unbounded off-camera record is retained in all four test clusters.

## Final hashes

- `vf-geom-wgpu.js` SHA-256:
  `07c16cedf58428c7c2c362a470f2dba7797a779013c0e1eb4b9ad01bc1ff4a96`
- renderer wiring test SHA-256:
  `075a14c5a5567b163a274ace304b0a3c4d2d4fe13ccc199b1e9ec07cf8442f8c`
- camera seam test SHA-256:
  `8152ae38e718ad89ce81551b9aabe0965d63b12e3110f343455a48861991aca4`
- consumed clustered planner SHA-256:
  `74d2c7615084bff470cccc38a72ceef40fa502243368992f076baa182b68bd3b`
- consumed view-bounds module SHA-256:
  `2517cc96fa9bc92f3b069513a3defd3c79a97e210d14c788162078d9be4713c4`
- Binary/artifact hash: not applicable; JavaScript renderer wiring only

## Broader regression receipt

- Command: `npm test`
- Exit/duration: 1 after 11.51 s; 381 tests, 378 passed and 3 failed
- Every owned projected-bounds, clustered-light, renderer wiring, shader, and
  render-evidence test passed in the complete process.
- The three failures reproduce integration-base mismatches outside all owned
  paths: stale generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/geom/vf-geom-wgpu.js`, the two renderer projected-
  bounds test files, and this receipt.
- `vf-clustered-light-plan.mjs` and `vf-light-view-bounds.mjs` are consumed
  unchanged from the integration base.
- No WGSL source, bind layout, light record layout, clustered plan layout,
  shading equation, or public API changed.
- Recovery: removing the four implementation commits restores the prior
  conservative full-frustum planner inputs without changing stored scene data.
