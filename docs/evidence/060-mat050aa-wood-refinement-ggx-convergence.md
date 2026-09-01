# 0.6.0 MAT050AA — wood refinement GGX-convergence evidence

## Scope

- Base: `b61a8501` (`MAT050Z`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded error oracle comparing coherent side-grain GGX
  refinement profiles with their finest retained reference.
- No public VKF syntax, API, schema, ABI, shared 0.4/0.5 code, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Plan fit

The accepted 0.6 geometry/material matrix requires fine results to converge
toward a high-resolution reference under decreasing error tolerance. MAT050AA
measures that behavior over MAT050Z's already-bounded internal profiles. It
does not define a public error budget, refinement handle, or renderer policy.

## Observable behavior

For deterministic side-grain profiles at detail levels 0, 1, and 2, the finest
retained level is the internal reference. Maximum absolute errors across the
two retained azimuth probes are:

| Detail | Specular error | Reflected-RGB error |
| --- | ---: | ---: |
| 0 | 0.0014321702 | 0.0162500590 |
| 1 | 0.0000243811 | 0.0005531460 |
| 2 | 0 | 0 |

Both error series strictly decrease. The oracle derives these values from the
packed MAT050Z planes and retains their exact Float32 representation, making
the convergence claim reproducible rather than visual or qualitative.

## RED / GREEN

- Baseline `b61a8501`: the focused renderer suite passed 13/13 (exit 0,
  3.389 s) on Node.js 24.11.0 / Windows x64.
- RED `0128bfb6`: the focused suite failed at module instantiation because
  `evaluateWoodRefinementGgxConvergenceReference` did not exist (exit 1,
  0.832 s).
- GREEN `df444864`: exact error planes, decreasing flags, and zero finest-level
  errors passed 14/14 (exit 0, 3.326 s).

## Bounds and rejection

The source family must be MAT050Z's versioned profile packet with one to four
refinements and one to 64 probes. Detail, specular, and RGB plane lengths and
typed-array representations are validated before error allocation. Retained
convergence storage is at most 32 bytes: two Float32 error planes of four
entries each. Evaluation is linear in the already-bounded packed profile
planes and realizes no geometry, material, or probe copies.

## Executable evidence

Full private MAT010-through-MAT050AA procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 60/60 pass, 0 fail, exit 0, 10.165 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, coherent end/side material packets, filtered
  normals, anisotropic lobe transport, area weighting, orientation/refinement
  profiles and convergence, white-furnace energy, and all current refinements
  remain green.
- `git diff --check b61a8501..df444864` is clean.

## Offscreen boundary decision

`git diff --name-only b61a8501..df444864` contains only:

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
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `6fe16c59885dc50474905a6e3ab970be052030b3` | `9AEADDB7F597DB5B593231A01C449048BAD0B18378C12D48137F70B18E375687` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `cf054fc46516263f690e7786fba35f7ab8a59ad1` | `7819B32C242AC6D5FDA2FFF468A046626ED5D1E858AE65239E933834461ECD4C` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050AA advances the 0.6 material correctness gate from distinct retained
refinements to a quantitative finest-reference convergence oracle. It does not
yet establish demand/eviction integration, projected error policy, measured
species parameters, goodness-of-fit, GPU/native parity, procedural road
coverage, public controls, or release integration. Re-evaluated estimated
0.6.0 completion is **46.0%**, up **0.5 percentage points** from MAT050Z's
45.5%.

Recovery is `git revert` of commits after `b61a8501`; only the private wood
renderer packet, its focused test, and this receipt are owned.
