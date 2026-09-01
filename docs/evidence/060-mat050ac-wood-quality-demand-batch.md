# 0.6.0 MAT050AC — wood quality-demand batch evidence

## Scope

- Base: `e7c48b42` (`MAT050AB`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded batch for independent wood GGX quality demands over
  MAT050AB's refinement selector.
- No public VKF syntax, API, schema, ABI, shared 0.4/0.5 code, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Plan fit

The accepted 0.6 demand model requires generated facts to remain independent
of earlier demand order and working sets to reject over-budget realization.
MAT050AC exercises those properties over internal material-quality demands. It
does not introduce a cache, eviction policy, public quality control, or camera
integration.

## Observable behavior

Three paired specular/RGB budgets select side-grain detail levels 0, 1, and 2.
Reordering the demands as 2, 0, 1 reorders only the result rows: selected
refinement, detail level, retained packet identity, and achieved error remain
identical per demand. A three-demand request against a two-demand budget is
rejected before vector allocation.

The batch retains MAT050AB's source packet references rather than copying
procedural geometry or material planes. This isolates ordering and capacity
behavior from future scheduling and cache-policy decisions.

## RED / GREEN

- Baseline `e7c48b42`: the focused renderer suite passed 15/15 (exit 0,
  3.403 s) on Node.js 24.11.0 / Windows x64.
- RED `0acb3fa7`: the focused suite failed at module instantiation because
  `selectWoodRefinementGgxProfileBatchReference` did not exist (exit 1,
  0.475 s).
- GREEN `4773f717`: canonical/reordered demand mappings and pre-allocation
  overflow rejection passed 16/16 (exit 0, 2.495 s).

## Bounds and rejection

Demand count is nonzero, validated before allocation, capped at 64, and cannot
exceed the caller's explicit budget. Each entry delegates to MAT050AB's finite,
non-negative error validation and at-most-four refinement scan. Retained typed
storage is at most 1,024 bytes: four 64-entry Uint32/Float32 planes. Demand and
source-packet reference lists are also capped at 64; no geometry, material, or
profile vectors are copied.

## Executable evidence

Full private MAT010-through-MAT050AC procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 62/62 pass, 0 fail, exit 0, 11.732 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, coherent end/side material packets, filtered
  normals, anisotropic lobe transport, area weighting, orientation/refinement
  profiles, convergence, quality selection and demand ordering, white-furnace
  energy, and all current refinements remain green.
- `git diff --check e7c48b42..4773f717` is clean.

## Offscreen boundary decision

`git diff --name-only e7c48b42..4773f717` contains only:

```text
tests/js/vf-wood-material-renderer-packet.test.mjs
web/vf-ui/vf-wood-material-renderer-packet.mjs
```

No shared renderer entrypoint, shader, 0.4/0.5 path, fixture, gallery, or visual
asset changed, so a new offscreen capture was not required. MAT050W's last
applicable hidden capture remains one running renderer with no failures or
WebGPU error, 58,298 bytes, SHA-256
`20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `1a85455579f99808f9c464852271bdbf719a8f20` | `5B587B292C98E93E854AA3990CB138936B93589FD2D0841EB0F2DE01A02EEEC9` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `13cb1181280b60633604d85b57479be2c82da6f9` | `438733498C94E8266896C217664FD5110E415FF795345E214AF7312A38D28222` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050AC advances the 0.6 demand/material gate from one quality selection to a
hard-bounded, demand-order-independent material selection batch. It does not
yet establish cache eviction/regeneration, projected screen error, measured
species parameters, goodness-of-fit, GPU/native parity, procedural road
coverage, public controls, or release integration. Re-evaluated estimated
0.6.0 completion is **47.0%**, up **0.5 percentage points** from MAT050AB's
46.5%.

Recovery is `git revert` of commits after `e7c48b42`; only the private wood
renderer packet, its focused test, and this receipt are owned.
