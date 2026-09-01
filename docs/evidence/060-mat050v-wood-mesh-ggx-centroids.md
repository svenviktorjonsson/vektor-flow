# 0.6.0 MAT050V — wood mesh GGX-centroid evidence

## Scope

- Base: `54104279` (`MAT050U`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded CPU tracer that evaluates the centroid of every
  complete retained procedural wood triangle.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Observable behavior

The real 5 x 5 MAT010-through-MAT050U side-grain cut contains 32 complete
triangle faces. MAT050V visits triangle indices 0 through 31 exactly once at
barycentric centroid `[1/3, 1/3, 1/3]` and retains Float32 planes for:

- triangle identity and world position;
- normalized world-space surface normal;
- anisotropic GGX specular BRDF; and
- reflected procedural RGB.

Every face's retained values match an independent MAT050R face sample plus
MAT050S GGX response after Float32 conversion. This proves the entire cut mesh,
not one selected face, reaches the procedural anisotropic shading seam while
preserving its complete face indices.

This is a private mesh-wide differential trace. It does not define a renderer
ABI, pixel coverage, visibility, or a draw submission.

## RED / GREEN

- Baseline `54104279`: the focused renderer suite passed 8/8 (exit 0, 2.096 s)
  on Node.js 24.11.0 / Windows x64.
- RED `753e97bc`: the focused suite failed at module instantiation because
  `evaluateWoodMeshGgxCentroidsReference` did not exist (exit 1, 0.282 s).
- GREEN `b5a2e4f7`: all 32 centroid responses matched their independent scalar
  references and passed 9/9 (exit 0, 2.049 s).

## Bounds and rejection

Triangle count is checked before allocation and capped at 4,096. Each centroid
retains 44 bytes across triangle identity, position, normal, specular, and RGB
planes, bounding vector storage at 180,224 bytes. MAT050Q's source packet limits
remain unchanged; an under-budget mesh is rejected before mesh-wide planes are
allocated.

## Executable evidence

Full private MAT010-through-MAT050V procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 55/55 pass, 0 fail, exit 0, 9.491 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, filtered normals, anisotropic lobe transport,
  directional response, bounded face coverage and batching, white-furnace
  energy, and all current end-grain/side-grain refinements remain green.
- `git diff --check 54104279..b5a2e4f7` is clean.

## Hidden capture

Port 19503 was verified unused before the offscreen Edge/WebGPU boundary
capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050v-renderer-boundary.png 0 19503 rock_material_field_frame
```

- One renderer remained running with no initialization/runtime failures and no
  WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- The capture exactly matches MAT050P through MAT050U, proving this private
  mesh trace did not alter the frozen shared renderer or mirror boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `80c18a8a753d0be2f080b75a116bf63cbe2edce2` | `DC20F0AFBC5EF0625C022CB8CF6330697889646AD9574A264736FB2637A145DB` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `3066eeb674872a8748205740307b02a14601d911` | `9189B63A81DEF997A1D308169FACA07BCF7D41FB6B83E7E9AEB0AAF88BFFF187` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050V advances the 0.6 procedural-material acceptance path from complete
single-face coverage to one anisotropic response for every retained mesh face.
Estimated 0.6.0 completion is **43.5%**, up **0.5 percentage points** from
MAT050U's 43.0%.

It does not submit wood packets to WebGPU, change shared culling or mirror
shading, define visibility or pixel coverage, freeze measured wood parameters,
expose author controls, or define a public compact-PBR contract. Recovery is
`git revert` of commits after `54104279`; only the private wood renderer packet,
its focused test, and this receipt are owned.
