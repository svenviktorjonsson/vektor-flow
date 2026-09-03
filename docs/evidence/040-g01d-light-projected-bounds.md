# 040-G01D projected light-bounds evidence

Recorded: 2026-08-31 08:35:05 +02:00

## Packet identity

- Packet: `040-G01D`, 0.4 GFX-040 Gate 3
- Base: `e8c3d766c1dd7d6eebdb999070c27eb41d7b5e80`
- Implementation head before this receipt: `ed5f42531d02bf7be17df45afdd3700b3adc3f9d`
- Implementation tree before this receipt: `09923c52fdddcb60162177799136ca867c84e0de`
- Branch: `codex/0.4/040-g01d-light-projected-bounds`
- Environment: Microsoft Windows NT 10.0.26200.0, Node.js v24.11.0
- Scope: pure internal world-to-view projection and clustered-planner
  composition; no public VKF API and no renderer wiring

## Slice 1: point-light view bounds

- RED command: `node --test tests/js/vf-light-view-bounds.test.mjs`
- RED exit/duration: 1 after 0.19 s
- RED result: `ERR_MODULE_NOT_FOUND` for the not-yet-created projection
  module
- GREEN exit/duration: 0 after 0.23 s; 6 tests passed
- Commit: `9a95301 feat(graphics): project point light bounds`

Observable behavior: finite point spheres produce conservative NDC x/y and
positive view-depth bounds; wholly off-frustum spheres are culled; near-plane
intersections stay finite; and zero-radius lights on a boundary survive.

## Slice 2: shaped-light view bounds

- RED command: `node --test tests/js/vf-light-view-bounds.test.mjs`
- RED exit/duration: 1 after 0.36 s; 4 intended failures because only point
  lights were implemented
- GREEN exit/duration: 0 after 0.38 s; 10 tests passed
- Commit: `15e1fdb feat(graphics): project shaped light bounds`

Observable behavior: spot cones use a conservative sphere envelope;
projected/geometry-light point sets use a finite enclosing sphere; both cull
off-frustum envelopes and retain finite near-plane intersections.

## Slice 3: clustered-planner composition

- RED command: `node --test tests/js/vf-clustered-light-view-plan.test.mjs`
- RED exit/duration: 1 after 0.19 s
- RED result: missing `planViewClusteredLights` export
- GREEN command: `node --test tests/js/vf-clustered-light-view-plan.test.mjs tests/js/vf-clustered-light-plan.test.mjs tests/js/vf-light-view-bounds.test.mjs`
- GREEN exit/duration: 0 after 0.37 s; 18 tests passed
- Commit: `be81605 feat(graphics): compose light view clusters`

The composition API requires exact camera/grid near/far agreement, maps
geometry lights to the planner's internal projected kind, preserves stable
light-ID ordering, and records culled projected lights without creating jobs.

For a 4 x 2 x 4 grid, the known point envelope `x/y = [-0.25, 0.25]` and
positive view depth `[4, 6]` occupies exact x-fastest/log-depth cluster IDs
`[17, 18, 21, 22, 25, 26, 29, 30]`. This pins the CPU plan to the same inputs
needed by a WGSL cluster-index path: positive view depth plus exact grid
near/far and slice counts.

## Matrix/depth convention robustness

- RED command: `node --test tests/js/vf-light-view-bounds.test.mjs`
- RED exit/duration: 1 after 0.24 s; 10 passed and 1 intended failure because
  an OpenGL minus-one-to-one depth projection was accepted
- GREEN focused command: `node --test tests/js/vf-clustered-light-view-plan.test.mjs tests/js/vf-clustered-light-plan.test.mjs tests/js/vf-light-view-bounds.test.mjs`
- GREEN exit/duration: 0 after 0.31 s; 19 tests passed
- Commit: `ed5f425 fix(graphics): enforce WebGPU light depth`

Tests pin the repository's `vf-geom-math.js` convention: column-major matrices
multiply column vectors; camera-forward view z is negative; cluster depth is
positive `-viewZ`; and `mat4PerspectiveZ01` maps the near plane to NDC z=0 and
the far plane to NDC z=1. The module rejects an OpenGL z=-1 near plane before
planning.

## Final hashes

- `vf-light-view-bounds.mjs` SHA-256:
  `f0dfb3b4cd4136ba7a169c99fae9a39e4b85d36f240495f621156dd5c76eb4d0`
- `vf-clustered-light-plan.mjs` SHA-256:
  `e55c9a57a1d8cadce2e7e9649cb0bb09ed54c89ec39af1c482d6ef5ab880e5b2`
- `vf-light-view-bounds.test.mjs` SHA-256:
  `027faf9d35a4508e10bf1ee49f118c97eccadd79c54c2ccefa5f2e96ee1b6a20`
- `vf-clustered-light-view-plan.test.mjs` SHA-256:
  `ab65de9715f9d1aff97223577cf364ad49955e9787f5c6f4fd370375875fc59e`
- Binary/artifact hash: not applicable; pure JavaScript modules

## Broader regression receipt

- Command: `npm test`
- Exit/duration: 1 after 7.39 s; 367 passed and 3 failed
- Every owned projected-bounds and clustered-light test passed in the complete
  process.
- The three failures reproduce integration-base mismatches outside every owned
  path: stale generated HTML component catalog, symbolic document scope, and
  symbolic named function/constant geometry.

## Handoff

- Owned paths: `web/vf-ui/geom/vf-light-view-bounds.mjs`,
  `web/vf-ui/geom/vf-clustered-light-plan.mjs`, both focused test files, and
  this receipt.
- Protected path `web/vf-ui/geom/vf-geom-wgpu.js` was not edited.
- Recovery: the new projection module and composition export are internal and
  unwired; reverting this packet cannot alter current rendered output.
- Next packet may consume `planViewClusteredLights` at the renderer seam and
  mirror its positive-depth logarithmic indexing exactly in WGSL.
