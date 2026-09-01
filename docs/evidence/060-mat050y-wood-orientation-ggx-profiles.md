# 0.6.0 MAT050Y — wood orientation GGX-profile evidence

## Scope

- Base: `d21e9bdf` (`MAT050X`).
- Branch: `codex/0.6/060-mat050o-wood-ggx-furnace`.
- Adds one private bounded orientation-family oracle over coherent end-grain and
  side-grain procedural wood cuts.
- No public VKF syntax, API, schema, ABI, shared 0.4/0.5 code, WebGPU shader,
  gallery, fixture, media, example, manifest, mirror path, or golden changes.

## Plan fit

The accepted 0.6 research gate requires versioned material/statistical oracles
and coherent wood response across cut orientation. MAT050Y compares internal
profiles under an already-proven model; it does not label the plausible profile
as measured or freeze a public compact-PBR mapping.

## Observable behavior

Two deterministic cuts built from the same wood generator identity are carried
through complete faces, tangent-normal sampling, anisotropic GGX response,
area weighting, and MAT050X azimuth profiling:

- end grain uses the retained radial-U/radial-V cut frame;
- side grain uses the retained radial-U/trunk-axis cut frame.

At azimuths `0` and `pi/2`, the packed family specular and RGB rows are
byte-equal to independent MAT050X profiles. The maximum cross-orientation
specular delta is greater than `1e-4`, proving the research oracle distinguishes
the two coherent cut orientations instead of flattening them into one material.

## RED / GREEN

- Baseline `d21e9bdf`: the focused renderer suite passed 11/11 (exit 0,
  1.935 s) on Node.js 24.11.0 / Windows x64.
- RED `d3585cb1`: the focused suite failed at module instantiation because
  `evaluateWoodOrientationGgxProfilesReference` did not exist (exit 1,
  0.248 s).
- GREEN `9b05128c`: both orientation rows matched their independent profiles and
  passed 12/12 (exit 0, 1.250 s).

## Bounds and rejection

Material profile count is validated before family-plane allocation and capped
at four. MAT050X's 64-probe limit remains authoritative. Retained family vector
storage is bounded at 4,352 bytes: one shared azimuth plane plus specular and
RGB values for at most four by 64 profile rows. Each material profile is
realized and copied independently, preserving MAT050X/MAT050W's existing
triangle and transient working-set bounds.

## Executable evidence

Full private MAT010-through-MAT050Y procedural chain:

```text
node --test tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-forest-population.test.mjs tests/js/vf-tree-geometry-plan.test.mjs tests/js/vf-wood-growth-coordinates.test.mjs tests/js/vf-wood-volume-field.test.mjs tests/js/vf-wood-cut-plane-grid.test.mjs tests/js/vf-wood-cut-surface-packet.test.mjs tests/js/vf-wood-cut-material-packet.test.mjs tests/js/vf-wood-material-energy.test.mjs tests/js/vf-wood-material-renderer-packet.test.mjs
```

- 58/58 pass, 0 fail, exit 0, 7.228 s on Node.js 24.11.0 / Windows
  x64.
- Complete face consumption, coherent end/side material packets, filtered
  normals, anisotropic lobe transport, area weighting, azimuth response,
  white-furnace energy, and all current refinements remain green.
- `git diff --check d21e9bdf..9b05128c` is clean.

## Offscreen boundary decision

`git diff --name-only d21e9bdf..9b05128c` contains only:

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
| `web/vf-ui/vf-wood-material-renderer-packet.mjs` | `9b97a99fe6ac64de29b1431cba60fbb6d9f0d5f4` | `D5C42BAB8804EFBA9767AAC8F05FE234818C03878B3C07F82C7DAFC51A923EB9` |
| `tests/js/vf-wood-material-renderer-packet.test.mjs` | `d9ace28aed6d3ac1912c2e85bbacda7662989293` | `98115ABCDB49AAED4620F1D188B717E42AA0F42CFB8E8E779EFE317DEF2A2E3F` |
| `web/vf-ui/vf-wood-material-energy.mjs` | `7b209090ab4a72d7e6e85586875d09f692e2962d` | `385036B2E6F2E1CD699FFA8FE216DC2161F07BAF706FE430D051108A1DA7D1E8` |

## Acceptance and recovery

MAT050Y advances the 0.6 material-distribution/research-oracle gate from one
cut's azimuth response to bounded cross-orientation comparison for coherent
wood. It does not yet establish measured species parameters, goodness-of-fit,
GPU/native parity, procedural road coverage, public controls, or release
integration. Re-evaluated estimated 0.6.0 completion is **45.0%**, up **0.5
percentage points** from MAT050X's 44.5%.

Recovery is `git revert` of commits after `d21e9bdf`; only the private wood
renderer packet, its focused test, and this receipt are owned.
