# 0.6.0 MAT050W — wood mesh GGX area-summary evidence

## Scope

- Base: `55f62412` (`MAT050V`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private deterministic area-weighted reduction over every retained
  procedural wood triangle's MAT050V centroid response.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Observable behavior

The real 32-face side-grain cut computes geometric area directly from each
complete indexed triangle. Those areas weight MAT050V's anisotropic specular
and reflected-RGB centroid planes into one whole-mesh summary.

The test independently recomputes every cross-product area and weighted sum.
All 32 stored Float32 triangle areas match; total area, mean specular, and all
three mean RGB channels agree within `1e-12`. The reconstructed retained area
also agrees with the authored rectangular cut area within 0.1%, accounting for
the source positions' retained Float32 world-coordinate quantization.

This is a private statistical material oracle. It does not define visibility,
pixel integration, a public renderer ABI, or a draw submission.

## RED / GREEN

- Baseline `55f62412`: the focused renderer suite passed 9/9 (exit 0, 1.718 s)
  on Node.js 24.11.0 / Windows x64.
- RED `d91bd437`: the focused suite failed at module instantiation because
  `evaluateWoodMeshGgxAreaSummaryReference` did not exist (exit 1, 0.346 s).
- The first GREEN attempt produced the exact independent weighted reduction but
  failed an assumed `1e-6` authored-area tolerance, observing a deterministic
  `0.00005159352582317922` delta from retained Float32 positions (9/10, exit 1,
  1.777 s).
- GREEN `719b0f9d`: the authored-area check was calibrated to a 0.1% relative
  retained-position tolerance while the independent weighted oracle stayed at
  `1e-12`; the focused suite passed 10/10 (exit 0, 1.668 s).

## Bounds and rejection

MAT050V validates the 4,096-triangle ceiling before realizing its centroid
planes. MAT050W adds exactly four bytes of retained area per admitted triangle,
so its combined centroid-plus-area vector storage is bounded at 196,608 bytes.
Every area must be finite and positive before the summary is returned.

## Executable evidence

Full private MAT010-through-MAT050W procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 56/56 pass, 0 fail, exit 0, 7.632 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, filtered normals, anisotropic lobe transport,
  directional response, bounded mesh tracing, face coverage, white-furnace
  energy, and all current end-grain/side-grain refinements remain green.
- `git diff --check 55f62412..719b0f9d` is clean.

## Hidden capture

Port 19505 was verified unused before the offscreen Edge/WebGPU boundary
capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050w-renderer-boundary.png 0 19505 rock_material_field_frame
```

- One renderer remained running with no initialization/runtime failures and no
  WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- The capture exactly matches MAT050P through MAT050V, proving this private
  reduction did not alter the frozen shared renderer or mirror boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `3282fb26895389d1517cc3935147255336effd65` | `8742DC55C76EBEB4EB29A5312CC55A5C22086D66D9180CF56379D7562D4BD3C4` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `4e3d50d99ae2df4b70b81cc9c449c6c0bb6dabe9` | `10F98930C85E33270D0D6232EDBC61AF7E380C54FBEBC9892B5D460D4D61E1CC` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050W advances the 0.6 procedural-material acceptance path from per-face
responses to a deterministic geometry-weighted whole-mesh material oracle.
Estimated 0.6.0 completion is **44.0%**, up **0.5 percentage points** from
MAT050V's 43.5%.

It does not submit wood packets to WebGPU, change shared culling or mirror
shading, define visibility or pixel integration, freeze measured wood
parameters, expose author controls, or define a public compact-PBR contract.
Recovery is `git revert` of commits after `55f62412`; only the private wood
renderer packet, its focused test, and this receipt are owned.
