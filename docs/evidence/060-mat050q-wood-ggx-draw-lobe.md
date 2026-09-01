# 0.6.0 MAT050Q — wood anisotropic GGX draw-lobe evidence

## Scope

- Base: `4e7a3adf` (`MAT050P`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Extends the private complete-triangle wood renderer packet with bounded,
  per-vertex anisotropic GGX lobe widths.
- Consumes the already-proven MAT050O reference profile: anisotropy `0.65`,
  minimum alpha `0.08`, and perceptual-roughness-squared conversion.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  fixture, media, example, manifest, mirror path, or golden changes.

## Observable behavior

One real MAT010-through-MAT050 side-grain cut produces 25 renderer vertices and
32 complete triangle faces. Its private draw packet now also carries:

- one `alphaX` value per retained vertex, aligned to the cut-plane tangent;
- one `alphaY` value per retained vertex, aligned to the bitangent;
- the explicit axis order `tangent, bitangent`; and
- a retained byte count for the two lobe planes.

The focused test compares all 25 alpha pairs with the existing converged
anisotropic GGX white-furnace oracle. Every pair matches exactly and has
`alphaX > alphaY`, so the proven lobe is no longer detached from the complete
triangle consumer.

This remains a private plausible reference profile. It does not claim measured
wood anisotropy or freeze author-facing material controls.

## Bounds

The retained lobe planes cost exactly eight bytes per vertex. The renderer
adapter rejects more than 65,536 vertices before lobe realization, bounding the
new allocation to 524,288 bytes. The real 25-vertex acceptance cut retains 200
bytes. The inherited 131,072-triangle limit remains unchanged.

## RED / GREEN

- Baseline `4e7a3adf`: the focused renderer and furnace pair passed 9/9 (exit
  0, 7.318 s) on Node.js 24.11.0 / Windows x64.
- RED `803c804c`: the new lobe-alignment test failed because `packet.ggxLobe`
  was absent (exit 1, 1.402 s).
- GREEN `d5a7217e`: per-vertex alpha planes and their tangent/bitangent binding
  passed 3/3 (exit 0, 1.694 s).
- RED `5e51ec92`: an otherwise valid 65,537-vertex packet was accepted and the
  capacity test failed with `Missing expected exception` (exit 1, 1.363 s).
- GREEN `5fa4602e`: the renderer adapter rejects over-capacity lobe planes
  before realization; the focused suite passed 4/4 (exit 0, 1.250 s).

## Executable evidence

Full private MAT010-through-MAT050Q procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 50/50 pass, 0 fail, exit 0, 4.973 s on Node.js 24.11.0 / Windows
  x64.
- Complete triangle winding, malformed face rejection, filtered normals,
  isotropic invariance, anisotropic tangent response, convergence, and every
  current end-grain/side-grain refinement remain green.
- `git diff --check 4e7a3adf..5fa4602e` is clean.

## Hidden capture

Offscreen Edge/WebGPU shared-renderer boundary capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050q-renderer-boundary.png 0 9491 rock_material_field_frame
```

- One renderer remained running with no initialization/runtime failures and no
  WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- The capture exactly matches MAT050P, proving this private packet did not alter
  the frozen shared renderer or mirror boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `12b34d306e43c4cad64fd6d0e9b5345f878023af` | `79E162A026251F88E4F22542675E66F1CE6D9C82D150DB99F91AB33511A5F65B` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `696766780a14e4d118472fde9f2f0ff16d4e4715` | `268BEFD150726D6C5DD692D4E890B91FFDF6C16BC27376184F6E43C1126882FA` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |
| `web/vf-ui/vf-wood-cut-material-packet.mjs` | `e5ea1daea28d54e25f33f3ff6d411bd7afdace58` | `F2BD1264B9D2CA9DC7D5F31895FE27EE901B4E69F0430CAF713EB2424B7ACD8B` |

## Acceptance and recovery

MAT050Q advances the 0.6 procedural-material acceptance path from complete
triangle consumption to a bounded draw packet whose anisotropic axes and lobe
widths agree with the existing white-furnace proof. Estimated 0.6.0 completion
is **41.0%**, up **0.5 percentage points** from MAT050P's 40.5%.

It does not submit wood packets to WebGPU, change shared culling or mirror
shading, solve multiple scattering, freeze measured wood parameters, expose
author controls, or define a public compact-PBR contract. Recovery is `git
revert` of commits after `4e7a3adf`; only the private wood renderer packet, its
focused test, and this receipt are owned.
