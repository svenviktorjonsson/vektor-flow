# 0.6.0 MAT050AB — wood refinement quality-selection evidence

## Scope

- Base: `27d27086` (`MAT050AA`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded selector that chooses the coarsest retained wood GGX
  refinement satisfying paired specular and reflected-RGB error budgets.
- No public VKF syntax, API, schema, ABI, shared 0.4/0.5 code, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Plan fit

The accepted 0.6 demand model refines procedural geometry and material fields
until active quality budgets are satisfied. MAT050AB exercises that rule over
MAT050AA's quantitative internal errors. It does not choose public tolerances,
define a public refinement handle, or integrate camera/projected-error policy.

## Observable behavior

For deterministic side-grain profiles at detail levels 0, 1, and 2, three
paired budgets are set exactly to each retained refinement's MAT050AA specular
and RGB error. Scanning coarse-to-fine selects detail levels 0, 1, and 2,
respectively. Every selection retains its source packet and exact achieved
errors, and both achieved errors are at or below their requested maxima.

The test derives budgets from the versioned convergence planes rather than
embedding a product policy. This pins the selection mechanism while leaving
future quality thresholds under the Language Design Authority.

## RED / GREEN

- Baseline `27d27086`: the focused renderer suite passed 14/14 (exit 0,
  3.187 s) on Node.js 24.11.0 / Windows x64.
- RED `4d7d85f2`: the focused suite failed at module instantiation because
  `selectWoodRefinementGgxProfileReference` did not exist (exit 1, 0.718 s).
- GREEN `478c5cc8`: coarse-to-fine selections, retained packets, and achieved
  errors passed 15/15 (exit 0, 2.532 s).

## Bounds and rejection

The source must be MAT050AA's versioned convergence packet backed by one to
four MAT050Z refinement profiles. Error planes, detail levels, and packet count
are validated before selection. Both requested maxima must be finite and
non-negative; a forged family that cannot satisfy them is rejected. Selection
is a bounded scan of at most four entries and retains no new vectors
(`vectorBytes = 0`).

## Executable evidence

Full private MAT010-through-MAT050AB procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 61/61 pass, 0 fail, exit 0, 10.589 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, coherent end/side material packets, filtered
  normals, anisotropic lobe transport, area weighting, orientation/refinement
  profiles, convergence and quality selection, white-furnace energy, and all
  current refinements remain green.
- `git diff --check 27d27086..478c5cc8` is clean.

## Offscreen boundary decision

`git diff --name-only 27d27086..478c5cc8` contains only:

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
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `3e7d70eea4a9739aa12922830320a8b8fe43cfa2` | `7D49BBB392867CBF9D7A8DFC84032E6FFA9344C8771D9DCF9D83A65D60B551AD` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `e89c8f786314223c01d1e30a950d34b190683234` | `EC78D8C2739810DF2C4EC7711DFE7DD9E197948A407977B3708A512AA70829A5` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050AB advances the 0.6 demand/material gate from measuring refinement error
to choosing the least-detailed retained result that satisfies a supplied
quality budget. It does not yet establish cache demand/eviction, projected
screen error, measured species parameters, goodness-of-fit, GPU/native parity,
procedural road coverage, public controls, or release integration.
Re-evaluated estimated 0.6.0 completion is **46.5%**, up **0.5 percentage
points** from MAT050AA's 46.0%.

Recovery is `git revert` of commits after `27d27086`; only the private wood
renderer packet, its focused test, and this receipt are owned.
