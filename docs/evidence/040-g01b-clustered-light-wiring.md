# 040-G01B clustered-light renderer wiring evidence

Recorded: 2026-08-31 07:44:54 +02:00

## Packet identity

- Release: 0.4.0, GFX-010 clustered-light foundation
- Branch: `codex/0.4/040-g01b-clustered-light-wiring`
- Base commit: `448ce5154aef98528ee43cb76f772984031837c4`
- Implementation head: `e1f5f9bd1b5afb42893add8d4b39da3ed107dc0d`
- Implementation tree: `2ecb23c900dca2b3ecd690d2bea3f36a5dc9e974`
- Environment: Windows x64, Node.js v24.11.0

## Owned paths

- `web/vf-ui/geom/vf-geom-wgpu.js`
- `tests/js/vf-geom-clustered-light-wiring.test.mjs`
- `tests/js/vf-geom-render-evidence.test.cjs`
- `docs/evidence/040-g01b-clustered-light-wiring.md`

The packet changes no VKF syntax, public API, light schema, or shader-visible
material semantics.

## RED evidence

Focused command:

```text
node --test tests/js/vf-geom-clustered-light-wiring.test.mjs
```

The first cycle failed because the real renderer had no
`_planClusteredLightsForFrame` function. The second cycle retained the first
green behavior but failed `0 !== 2`: no GPU storage buffers were created for
the cluster plan and resolved light records.

## GREEN evidence

Commands at implementation head:

```text
node --test tests/js/vf-clustered-light-plan.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs
node tests/js/vf-geom-render-evidence.test.cjs
node --check web/vf-ui/geom/vf-geom-wgpu.js
```

Results: seven Node tests passed, the render-evidence script passed, and the
renderer syntax check passed.

Observable six-light fixture evidence with a 2 x 1 x 2 grid and cap four:

- `activeLights = 0` before the legacy shading path runs;
- `plannedLights = 6`;
- `lightClusters = 4`;
- `lightClusterAssignments = 16`;
- `lightClusterOverflowAssignments = 8`;
- `lightClusterOverflowClusters = 4`; and
- `lightClusterCap = 4`.

The storage cycle uses a one-cluster fixture with the same six lights. It
uploads a 56-byte plan containing the grid, cap, counts, CSR offsets, and four
retained light indices plus 384 bytes of packed 64-byte light records. Both
buffers carry `STORAGE | COPY_DST`, enter one read-only storage bind group, and
are bound as group one on the renderer's real scene draw paths.

Implementation commits:

- `8aaaeb0` — load and invoke the planner from batch and single-mesh renderer
  paths; extend deterministic render evidence beyond four planned lights.
- `e1f5f9b` — upload cluster/light storage and bind it through the main WebGPU
  pipeline layout.

## Compatibility boundary and next blocker

Pixels remain on the established four-light uniform shader. The new storage
group is deliberately bound but not read by WGSL, so this packet proves the
renderer-to-GPU transport seam without changing existing images. A shader
consumer is the next packet and requires image-oracle fixtures before replacing
the four-light calculations.

Renderer bounds are currently the conservative full frustum for each resolved
light. This cannot cull spatially and is not the intended performance endpoint;
projected sphere/cone/aperture bounds and plan caching must precede a 10,000-light
performance claim. These are explicit remaining implementation limits, not
silent fallbacks.

The focused GPU test uses a deterministic WebGPU facade to inspect descriptors,
uploaded bytes, bindings, and evidence. It does not claim a physical-GPU timing
or browser capture.

## Full JavaScript suite baseline

```text
npm test
```

Result: 348 tests, 345 passed, 3 failed. Both new wiring tests, the five planner
tests, and the neighboring render-evidence test passed. The same unrelated
integration-baseline failures remain:

- stale generated HTML component catalog;
- symbolic document result `-8` versus expected `8`; and
- symbolic literal geometry result `-624` versus expected `625`.

## Source hashes

| Source | Git blob | SHA-256 |
|---|---|---|
| `web/vf-ui/geom/vf-geom-wgpu.js` | `2aa6895bbe19cd733e4f2e8db965dc9245d13348` | `3845b052fae9c12759c88cc0d7bc0943ee6df7b25fb952c455771e296fd88c70` |
| `tests/js/vf-geom-clustered-light-wiring.test.mjs` | `d05e4bb3a045664567576d6861cdc2e3711107d1` | `6947b6a8fc3444f2136cabddeed3a77fd360326ae3a52352978f7e17577b251c` |
| `tests/js/vf-geom-render-evidence.test.cjs` | `e2c70567d71e882d2f0f9d43517dde3ce5b5b644` | `5d71722c940cb167e6c4c8da4e1a3d1351ea1c9ae2b6d1a71cefd791731ea451` |
