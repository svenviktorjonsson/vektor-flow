# 0.6.0 MAT050U — wood face GGX-coverage evidence

## Scope

- Base: `e8de4fc8` (`MAT050T`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private deterministic barycentric lattice over a complete retained
  procedural wood triangle and feeds it through MAT050T's bounded GGX batch.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Observable behavior

One real MAT010-through-MAT050T side-grain triangle is covered at subdivision
level 3. The lattice contains ten probes in stable tangent-step/bitangent-step
order, including all three corners and the centroid. It retains packed Float32
barycentric weights plus MAT050T's position, world normal, anisotropic specular,
and reflected-RGB planes.

Every retained plane is byte-equal to an independent MAT050T batch over the
same ten analytically generated weights. This proves complete face-domain
coverage reaches the existing procedural sampling and GGX response path without
bypassing the triangle indices or inventing a screen-space rasterizer.

This remains a private CPU differential reference. Its lattice and object shape
are not a public renderer ABI or a pixel-coverage rule.

## RED / GREEN

- Baseline `e8de4fc8`: the focused renderer suite passed 7/7 (exit 0, 1.374 s)
  on Node.js 24.11.0 / Windows x64.
- RED `d1dbe412`: the focused suite failed at module instantiation because
  `evaluateWoodTriangleGgxCoverageReference` did not exist (exit 1, 0.278 s).
- GREEN `53b5c1ac`: the ten-probe lattice matched its independent batch and
  passed 8/8 (exit 0, 1.828 s).

## Bounds and rejection

Subdivision count is validated before allocation and capped at 89, producing
at most 4,095 probes under MAT050T's 4,096-probe limit. Each coverage probe
retains 52 bytes across barycentric weights and the inherited response planes,
so retained vector storage is bounded at 212,940 bytes. The explicit sample
budget must admit the full triangular number before the lattice is allocated.

## Executable evidence

Full private MAT010-through-MAT050U procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 54/54 pass, 0 fail, exit 0, 9.156 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, filtered normals, anisotropic lobe transport,
  directional response, bounded batching, quadrature convergence,
  white-furnace energy, and all current end-grain/side-grain refinements remain
  green.
- `git diff --check e8de4fc8..53b5c1ac` is clean.

## Hidden capture

The first attempt used port 9499 and exited 1 after 22.604 s with `file target
missing`. The fixture existed, but read-only inspection found two unrelated
Edge CDP listeners already bound to that port. No renderer state or PNG was
produced. Those external sessions were left untouched.

After verifying port 19501 was unused, the isolated capture command was:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html .w/mat050u-renderer-boundary.png 0 19501 rock_material_field_frame
```

- One renderer remained running with no initialization/runtime failures and no
  WebGPU error.
- PNG size: 58,298 bytes.
- SHA-256:
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.
- The successful isolated capture exactly matches MAT050P through MAT050T,
  proving this private coverage work did not alter the frozen shared renderer
  or mirror boundary.
- The transient capture was removed after verification.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `aa414aa7db648319bec2fd95da0f7af72059d6a0` | `912149327B0C328D2B3A4BB3B26AB07416FB6B27252E57F6288E07A807759137` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `6ff779360291b3e989f1f5acc0561e6072a4a7f9` | `4F5CE3A38081F13B3D3042A9328180708B908509F0FCDE808C04AE2ABCE5ACB0` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050U advances the 0.6 procedural-material acceptance path from caller-listed
probes to deterministic complete face-domain coverage. Estimated 0.6.0
completion is **43.0%**, up **0.5 percentage points** from MAT050T's 42.5%.

It does not submit wood packets to WebGPU, change shared culling or mirror
shading, define pixel coverage, freeze measured wood parameters, expose author
controls, or define a public compact-PBR contract. Recovery is `git revert` of
commits after `e8de4fc8`; only the private wood renderer packet, its focused
test, and this receipt are owned.
