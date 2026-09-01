# 0.6.0 MAT050AD — wood selection-cache evidence

## Scope

- Base: `214fee66` (`MAT050AC`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded cache tracer for MAT050AC wood GGX quality
  selections, deterministic retained-order eviction, and exact regeneration
  after eviction.
- No public VKF syntax, API, schema, ABI, shared 0.4/0.5 code, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Plan fit

The accepted 0.6 demand model requires bounded demanded working sets and exact
regeneration of evicted detail. MAT050AD exercises the first private
selection-metadata slice of that gate over MAT050AC's order-independent quality
demands. It does not cache procedural geometry, material tiles, volume bricks,
GPU resources, or choose public quality and eviction policies.

## Observable behavior

A two-entry cache receives coarse and middle wood-quality demands, retains a
repeat middle demand as a hit, and evicts the oldest retained selection when a
fine demand arrives. Re-demanding the evicted coarse quality regenerates a new
selection record with the exact same retained source packet, detail level,
specular error, and reflected-RGB error.

The cache exposes a private immutable snapshot containing retained demand keys,
entry count/budget, hits, misses, and evictions. At every step the retained
entry count is at or below the explicit entry budget.

## RED / GREEN

- Baseline `214fee66`: the focused renderer suite passed 16/16 (exit 0,
  2.559 s) on Node.js 24.11.0 / Windows x64.
- RED `4835ec0e`: the focused suite failed during module instantiation because
  `createWoodRefinementGgxSelectionCacheReference` did not exist (exit 1,
  0.190 s).
- GREEN `4fb89816`: eviction, repeat-hit retention, regeneration identity, and
  bounded cache telemetry passed 17/17 (exit 0, 1.854 s).

## Bounds and determinism

The entry budget is validated before allocation, is nonzero, and is capped at
64. Cache keys contain the two finite non-negative quality thresholds. Each
miss delegates to MAT050AB's bounded coarsest-sufficient selector; hits retain
the prior immutable selection. Eviction always removes the oldest retained
key, so a fixed demand sequence has one fixed cache trace.

The cache retains at most 64 selection references and demand-key strings. It
allocates no procedural geometry, PBR vector plane, profile array, or copied
source packet. Regeneration creates a new zero-vector selection record that
points to the same deterministic retained packet.

## Executable evidence

Full private MAT010-through-MAT050AD procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 63/63 pass, 0 fail, exit 0, 10.348 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, coherent end/side material packets, filtered
  normals, anisotropic lobe transport, area weighting, orientation/refinement
  profiles, convergence, quality selection and batching, selection-cache
  eviction/regeneration, white-furnace energy, and all current refinements
  remain green.
- `git diff --check 214fee66..4fb89816` is clean.

## Offscreen boundary decision

`git diff --name-only 214fee66..4fb89816` contains only:

```text
tests/js/vf-wood-material-renderer-packet.test.mjs
web/vf-ui/vf-wood-material-renderer-packet.mjs
```

No renderer entrypoint, shader, 0.4/0.5 path, fixture, gallery, or visual asset
changed, so a new offscreen capture was not required. MAT050W's last applicable
hidden capture remains one running renderer with no failures or WebGPU error,
58,298 bytes, SHA-256
`20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `86770a0bcb80a28e1e277a74ef5db11bd2774ccc` | `53922EE1F4BCE724B5E50B34D180F1CFC6D9AD632D324BA8FE3D5B2E8BB15042` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `31a51f67d35b37fa2d3729f50d5d427c57735764` | `2449689EEDC129243FABCC3C6AD1DCCC9858E2D0DE24885CC65342E73C2DB151` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050AD advances the eviction/regeneration gate from bounded selections to a
hard-bounded private cache trace whose evicted selection regenerates with the
same material identity. It does not yet establish bounded geometry/material
residency, camera-driven demand, sparse tile/brick eviction, steady-state memory
evidence, projected screen error, measured species parameters, goodness-of-fit,
GPU/native parity, procedural road coverage, public controls, or release
integration. Re-evaluated estimated 0.6.0 completion is **47.4%**, up **0.4
percentage points** from MAT050AC's 47.0%.

Recovery is `git revert` of commits after `214fee66`; only the private wood
renderer packet, its focused test, and this receipt are owned.
