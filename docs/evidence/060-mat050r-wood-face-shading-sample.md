# 0.6.0 MAT050R — wood face-shading sample evidence

## Scope

- Base: `569fa617` (`MAT050Q`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private reference consumer that resolves an indexed procedural wood
  triangle at barycentric coordinates into a renderer-ready shading sample.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  fixture, media, example, manifest, mirror path, or golden changes.

## Observable behavior

One real MAT010-through-MAT050Q side-grain draw packet is sampled on triangle
7 at barycentric coordinates `[0.2, 0.3, 0.5]`. The consumer follows the three
stored face indices and interpolates:

- world position and procedural RGBA base color;
- the three decoded tangent normals, normalized after interpolation and
  transformed through the retained cut-plane tangent frame; and
- anisotropic GGX `alphaX` and `alphaY` along the tangent and bitangent.

The focused test independently computes every expected channel from the three
indexed vertices. Position, color, world-space normal, and both lobe widths
agree within `1e-7`; the world normal has unit length within `1e-12`; and the
sample retains the proven `alphaX > alphaY` anisotropic orientation.

This is a fixed-size CPU reference sample behind the private material seam. It
does not define a public renderer ABI, shade a light, or submit data to WebGPU.

## RED / GREEN

- Baseline `569fa617`: the focused renderer suite passed 4/4 (exit 0, 1.449 s)
  on Node.js 24.11.0 / Windows x64.
- RED `4a48ee4b`: the focused suite failed at module instantiation because
  `sampleWoodMaterialTriangleReference` did not exist (exit 1, 0.761 s).
- GREEN `8623da78`: the complete indexed-face interpolation path passed 5/5
  (exit 0, 1.371 s).

## Bounds and rejection

The consumer realizes only one requested face. Its temporary decoded-normal
plane is fixed at nine `Float64` values and does not scale with the source
packet. MAT050Q's 65,536-vertex and 131,072-triangle limits remain unchanged.
The face index must identify a complete retained triangle, and the three finite
non-negative barycentric weights must sum to one before sampling.

## Executable evidence

Full private MAT010-through-MAT050R procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 51/51 pass, 0 fail, exit 0, 9.776 s on Node.js 24.11.0 / Windows
  x64.
- The new face sample remains integrated with complete winding, malformed face
  rejection, filtered normals, GGX convergence, tangent response, white-furnace
  energy, and every current end-grain/side-grain refinement.
- `git diff --check 569fa617..8623da78` is clean.

## Hidden capture

Offscreen Edge/WebGPU shared-renderer boundary capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050r-renderer-boundary.png 0 9493 rock_material_field_frame
```

- One renderer remained running with no initialization/runtime failures and no
  WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- The capture exactly matches MAT050P and MAT050Q, proving the private
  face-sampling work did not alter the frozen shared renderer or mirror
  boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `5e1c383b6bca38a46182673360e4e39a9bf6f946` | `7201224CE69B18A6019805826F006F10A40157CC31531F9D08D4A167C7BFA5A2` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `1d7a9b409a4964d6500a22f30d69e33c73968545` | `CB40E8480C75D7EA4EC55C08A9B914289712F53D2B36E4F05873FA2DA02D3A31` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050R advances the 0.6 procedural-material acceptance path from a bounded
anisotropic draw packet to consumption of one real complete face as a shading
sample. Estimated 0.6.0 completion is **41.5%**, up **0.5 percentage points**
from MAT050Q's 41.0%.

It does not evaluate direct lighting, submit wood packets to WebGPU, change
shared culling or mirror shading, freeze measured wood parameters, expose
author controls, or define a public compact-PBR contract. Recovery is `git
revert` of commits after `569fa617`; only the private wood renderer packet, its
focused test, and this receipt are owned.
