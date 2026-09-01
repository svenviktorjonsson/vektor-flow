# 0.6.0 MAT050Z — wood refinement GGX-profile evidence

## Scope

- Base: `212f1436` (`MAT050Y`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded refinement-family oracle over coherent side-grain
  procedural wood cuts at detail levels 0, 1, and 2.
- No public VKF syntax, API, schema, ABI, shared 0.4/0.5 code, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Plan fit

The accepted 0.6 research gate requires versioned material/statistical oracles
and a demand/refinement story that does not erase coherent procedural response.
MAT050Z compares internal profiles under the already-proven model; it does not
define a public refinement contract, claim measured species parameters, or
freeze a compact-PBR mapping.

## Observable behavior

Three deterministic side-grain cuts built from one wood generator identity are
carried through complete faces, tangent-normal sampling, anisotropic GGX
response, area weighting, and azimuth profiling at detail levels 0, 1, and 2.

At azimuths `0` and `pi/2`, each packed refinement row is byte-equal to its
independently evaluated MAT050X profile. Retained detail levels are strictly
increasing, and the maximum adjacent-refinement specular delta is greater than
`1e-5`, proving that refinement remains observable rather than collapsing to a
duplicated material profile.

## RED / GREEN

- Baseline `212f1436`: the focused renderer suite passed 12/12 (exit 0,
  1.380 s) on Node.js 24.11.0 / Windows x64.
- RED `28917ab6`: the focused suite failed at module instantiation because
  `evaluateWoodRefinementGgxProfilesReference` did not exist (exit 1,
  0.287 s).
- GREEN `ce90d86c`: all refinement rows matched their independent profiles and
  passed 13/13 (exit 0, 1.529 s).

## Bounds and rejection

Refinement count is validated before family-plane allocation and capped at
four. Detail levels must be retained non-negative integers, strictly increasing,
and share one cut orientation. MAT050X's 64-probe limit remains authoritative.
Retained refinement-family vector storage is bounded at 4,368 bytes: 16 bytes
for four detail levels plus MAT050Y's 4,352-byte family maximum. Each refinement
profile is realized and copied independently, preserving MAT050X/MAT050W's
existing triangle and transient working-set bounds.

## Executable evidence

Full private MAT010-through-MAT050Z procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 59/59 pass, 0 fail, exit 0, 15.465 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, coherent end/side material packets, filtered
  normals, anisotropic lobe transport, area weighting, orientation and
  refinement profiles, white-furnace energy, and all current refinements remain
  green.
- `git diff --check 212f1436..ce90d86c` is clean.

## Offscreen boundary decision

`git diff --name-only 212f1436..ce90d86c` contains only:

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
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `39a7c510c08ee22c7a81cd49d391211a8963d19f` | `080A61C055960BAAA4A0A5219BF8B0AE3D48DDCE6FB41166EEFFCB1653F3BD0F` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `c05f9a9c8eaedeec85a780fce16e7e5a0cf4f1e7` | `BB23EC78B634BCAB8CF37D3DDF02A918BC15EB2336EFBF14162649C48B650B3F` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050Z advances the 0.6 material-distribution/research-oracle gate from
cross-orientation comparison to bounded cross-refinement comparison for
coherent wood. It does not yet establish demand/eviction integration, measured
species parameters, goodness-of-fit, GPU/native parity, procedural road
coverage, public controls, or release integration. Re-evaluated estimated
0.6.0 completion is **45.5%**, up **0.5 percentage points** from MAT050Y's
45.0%.

Recovery is `git revert` of commits after `212f1436`; only the private wood
renderer packet, its focused test, and this receipt are owned.
