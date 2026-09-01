# 0.6.0 MAT050T — wood face GGX-batch evidence

## Scope

- Base: `e7a934bd` (`MAT050S`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded CPU batch over MAT050R face samples and MAT050S
  directional anisotropic GGX responses.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  fixture, media, example, manifest, mirror path, or golden changes.

## Observable behavior

One real MAT010-through-MAT050S side-grain triangle is sampled at all three
face corners and its centroid. Under one fixed view/light pair, the batch emits
packed Float32 planes for:

- world position;
- normalized world-space surface normal;
- anisotropic GGX specular BRDF; and
- reflected procedural RGB.

Every packed value matches an independent call through the scalar face sampler
and GGX evaluator after Float32 conversion. This proves a complete retained
triangle can drive a small renderer-shaped probe batch without bypassing its
indices, procedural channels, tangent-normal transform, or anisotropic lobe.

The batch remains a private differential reference. Its object shape is not a
public renderer ABI and it is not submitted to WebGPU.

## RED / GREEN

- Baseline `e7a934bd`: the focused renderer suite passed 6/6 (exit 0, 1.983 s)
  on Node.js 24.11.0 / Windows x64.
- RED `9d71b023`: the focused suite failed at module instantiation because
  `evaluateWoodTriangleGgxBatchReference` did not exist (exit 1, 0.434 s).
- GREEN `01b63073`: the four packed probes matched their scalar references and
  passed 7/7 (exit 0, 3.007 s).

## Bounds and rejection

The batch validates its explicit sample budget before allocating. At most 4,096
probes may be requested. Each probe retains 40 bytes across position, normal,
specular, and RGB planes, so the total retained vector allocation is bounded at
163,840 bytes. MAT050Q's 65,536-vertex and 131,072-triangle limits remain
unchanged, and each barycentric probe still passes MAT050R validation.

## Executable evidence

Full private MAT010-through-MAT050T procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 53/53 pass, 0 fail, exit 0, 10.866 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, filtered normals, anisotropic lobe transport,
  directional response, quadrature convergence, white-furnace energy, and all
  current end-grain/side-grain refinements remain green.
- `git diff --check e7a934bd..01b63073` is clean.

## Hidden capture

Offscreen Edge/WebGPU shared-renderer boundary capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050t-renderer-boundary.png 0 9497 rock_material_field_frame
```

- One renderer remained running with no initialization/runtime failures and no
  WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- The capture exactly matches MAT050P through MAT050S, proving this private
  batch did not alter the frozen shared renderer or mirror boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `67d4be0f8203ff76438cd2641c23005d502600c2` | `F7834491EDB7450A4E209270283AAD7994C43BF418347B895AEE269929F610A6` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `93d5b4d7a671082e88d3b2b81a2f2308f1708ef0` | `65D123A99994F980199FF548A900C4E71F2DFCE058996C9C6B876CC246B87368` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050T advances the 0.6 procedural-material acceptance path from one scalar
face response to a bounded packed probe batch over a complete triangle.
Estimated 0.6.0 completion is **42.5%**, up **0.5 percentage points** from
MAT050S's 42.0%.

It does not submit wood packets to WebGPU, change shared culling or mirror
shading, rasterize coverage, freeze measured wood parameters, expose author
controls, or define a public compact-PBR contract. Recovery is `git revert` of
commits after `e7a934bd`; only the private wood renderer packet, its focused
test, and this receipt are owned.
