# 0.6.0 MAT050S — wood face GGX-response evidence

## Scope

- Base: `0c9b36b3` (`MAT050R`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private CPU reference that evaluates a directional anisotropic GGX
  response from one retained procedural wood face sample.
- Reuses MAT050O's Trowbridge-Reitz distribution, correlated Smith
  masking-shadowing, and Schlick dielectric Fresnel model.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  fixture, media, example, manifest, mirror path, or golden changes.

## Observable behavior

MAT050R resolves triangle 7 at barycentric coordinates `[0.2, 0.3, 0.5]`.
MAT050S evaluates that real shading sample under matched view/light directions
at cosine `0.72`, once along its projected tangent and once along its
bitangent. The response retains:

- anisotropic GGX distribution `D`;
- correlated Smith masking-shadowing `G`;
- dielectric Schlick Fresnel `F` with internal `F0 = 0.04`;
- diffuse and specular BRDF terms; and
- unit-light reflected RGB from the procedural base color.

All terms are finite and positive, `G` remains at most one, and `F` remains in
`[0.04, 1]`. Tangent and bitangent responses differ by more than `1e-4`.
Swapping `alphaX` and `alphaY` makes the bitangent response equal the original
tangent response within `1e-10`, proving the lobe widths follow the retained
surface frame rather than an ambient world axis.

This is one fixed directional CPU sample. It does not claim a rendered image,
multiple scattering, measured wood parameters, or a complete light transport
solution.

## RED / GREEN

- Baseline `0c9b36b3`: the focused renderer suite passed 5/5 (exit 0, 2.251 s)
  on Node.js 24.11.0 / Windows x64.
- RED `fd3da1dc`: the focused suite failed at module instantiation because
  `evaluateWoodFaceGgxResponseReference` did not exist (exit 1, 1.528 s).
- GREEN `ebbe4ca5`: the directional response and anisotropic-axis symmetry
  passed 6/6 (exit 0, 1.900 s).

## Bounds and rejection

The evaluator consumes one MAT050R sample and realizes only fixed-size local
vectors and one three-channel result. It does not allocate by vertex, triangle,
or hemisphere sample count. View and light inputs must be finite non-zero
vectors on the visible side of the sampled face. MAT050Q's 65,536-vertex and
131,072-triangle limits remain unchanged.

## Executable evidence

Full private MAT010-through-MAT050S procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 52/52 pass, 0 fail, exit 0, 10.559 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, filtered normals, anisotropic lobe transport,
  quadrature convergence, white-furnace energy, and every current
  end-grain/side-grain refinement remain green.
- `git diff --check 0c9b36b3..ebbe4ca5` is clean.

## Hidden capture

Offscreen Edge/WebGPU shared-renderer boundary capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050s-renderer-boundary.png 0 9495 rock_material_field_frame
```

- One renderer remained running with no initialization/runtime failures and no
  WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- The capture exactly matches MAT050P through MAT050R, proving this private
  response reference did not alter the frozen shared renderer or mirror
  boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `570e3d5de2a729ab786517fe83ca7606e740a54f` | `64480778C37ED3B0456D176A46B2A91A73C1DF6C9C4B88DAAAC7B15D6A5F2E9F` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `603c86d43f4a34ba1ebe7f334533dc74a3d86206` | `91880BE28F2EF89547D1E0C3871B82D2073BE510E1FC65B10A8F8C5701A9105F` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050S advances the 0.6 procedural-material acceptance path from an
anisotropic face sample to one directly evaluated GGX shading response.
Estimated 0.6.0 completion is **42.0%**, up **0.5 percentage points** from
MAT050R's 41.5%.

It does not submit wood packets to WebGPU, change shared culling or mirror
shading, solve multiple scattering, freeze measured wood parameters, expose
author controls, or define a public compact-PBR contract. Recovery is `git
revert` of commits after `0c9b36b3`; only the private wood renderer packet, its
focused test, and this receipt are owned.
