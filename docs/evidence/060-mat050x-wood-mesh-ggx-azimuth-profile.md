# 0.6.0 MAT050X — wood mesh GGX azimuth-profile evidence

## Scope

- Base: `7012378b` (`MAT050W`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded whole-mesh azimuth profile over MAT050W's
  area-weighted procedural wood response.
- No public VKF syntax, API, schema, ABI, shared 0.4 renderer, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Plan fit

The accepted 0.6 plan requires statistical/material oracles, coherent
geometry/PBR fields, and white-furnace correctness while compact-PBR mapping and
author controls remain unfrozen. MAT050X therefore extends the private material
oracle across view azimuth rather than introducing a public material contract.

## Observable behavior

The real 32-face side-grain cut is evaluated at cosine `0.72` for azimuths
`0`, `pi/2`, `pi`, and `3pi/2` around its retained tangent frame. Each probe
uses matched view/light directions and records area-weighted Float32 mean
specular and reflected RGB values.

All four profile rows byte-match independent MAT050W summaries after Float32
conversion. Tangent and bitangent mean specular values differ by more than
`1e-4`, proving the whole-mesh statistical oracle preserves the anisotropic
frame rather than collapsing to an azimuth-independent response.

This remains a private plausible-material profile. It does not freeze measured
wood parameters, a renderer ABI, public view probes, or author controls.

## RED / GREEN

- Baseline `7012378b`: the focused renderer suite passed 10/10 (exit 0,
  1.620 s) on Node.js 24.11.0 / Windows x64.
- RED `3bdb49f7`: the focused suite failed at module instantiation because
  `evaluateWoodMeshGgxAzimuthProfileReference` did not exist (exit 1,
  0.166 s).
- GREEN `e1d996bc`: all four profile rows matched independent summaries and
  passed 11/11 (exit 0, 1.131 s).

## Bounds and rejection

Probe count is validated before profile allocation and capped at 64. Retained
profile storage is 20 bytes per probe, at most 1,280 bytes. Each probe delegates
to MAT050W's 196,608-byte bounded mesh summary and releases that private summary
before the next retained profile row; even without intervening garbage
collection, cumulative per-call summary allocation is bounded below 12.6 MiB.
Azimuths must be finite and view cosine must lie in `(0,1]`.

## Executable evidence

Full private MAT010-through-MAT050X procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 57/57 pass, 0 fail, exit 0, 8.256 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, filtered normals, anisotropic lobe transport,
  directional response, bounded mesh tracing, area weighting, white-furnace
  energy, and all current end-grain/side-grain refinements remain green.
- `git diff --check 7012378b..e1d996bc` is clean.

## Offscreen boundary decision

`git diff --name-only 7012378b..e1d996bc` contains only:

```text
tests/js/vf-wood-material-renderer-packet.test.mjs
web/vf-ui/vf-wood-material-renderer-packet.mjs
```

No shared renderer entrypoint, shader, 0.4.x path, fixture, gallery, or visual
asset changed, so a new offscreen capture was not required. MAT050W's immediate
boundary capture remains applicable: one running renderer, no initialization or
runtime failures, no WebGPU error, 58,298 bytes, SHA-256
`20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `25dd2569df3a7dc87b5ddc8efe919c0b34eb031b` | `655E203F5938C690986847866CE61102ADF66DBD05C2BA0336CDB3B2C3C400D0` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `56cac3bb9d386a11f6f01148b2d73b631eb9cdec` | `8DEBB67BCF1D18F686CA7E3515043C70500C05C798F9E8F4B6007F5031EF6D9C` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050X advances the 0.6 geometry/material statistical-oracle gate from one
whole-mesh direction to a bounded anisotropic azimuth profile. It strengthens
material correctness but does not yet provide GPU/native target parity,
measured presets, road coverage, public author controls, or release integration.
Re-evaluated estimated 0.6.0 completion is **44.5%**, up **0.5 percentage
points** from MAT050W's 44.0%.

Recovery is `git revert` of commits after `7012378b`; only the private wood
renderer packet, its focused test, and this receipt are owned.
