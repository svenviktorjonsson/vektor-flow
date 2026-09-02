# 0.6.0 MAT060D — road crack-field evidence

## Scope

- Base: `7f4588e7` (`MAT060C`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road crack-field reference oracle and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires cracking to respond to load paths and exposure while geometry
and appearance stay attached to one field truth. MAT060D consumes MAT060B's
traffic/exposure drivers and borrowed MAT060A coordinates, adds one separately
keyed correlated fracture field, and realizes cracks only for demanded surface
cells.

The coefficients are synthetic acceptance values, not a measured pavement
claim. Research provenance, fitted presets, target lowering, and public author
controls remain separate release work. This JavaScript module is a private
correctness oracle, not a product-runtime dependency or package export.

## Observable behavior

Three demanded road cells realize one reproducible surface crack, one intact
surface cell, and one intact buried-layer cell. One shared crack-coverage
buffer drives aperture and depression plus albedo, roughness, and retained
wetness. The buried layer cannot receive a surface crack even when its
underlying fracture propensity is nonzero.

The result owns 108 vector bytes for fracture driver, coverage, aperture,
displacement, RGB albedo, roughness, and wetness. Coordinates, world positions,
and layer indices remain borrowed from MAT060B and are not copied or counted.
A three-sample budget leaves the fourth requested cell and the remaining
11,999,999,996 potential road cells unrealized.

## RED / GREEN

- Baseline `7f4588e7`: MAT060A-C, conditioned-distribution, and spatial-field
  suites passed 22/22 (exit 0, 1.820 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because `vf-road-crack-field.mjs` did not
  exist (exit 1, 0.438 s).
- GREEN: pinned geometry/PBR crack behavior and malformed-demand rejection
  passed 2/2 as part of the focused regression command below. During GREEN,
  zero aperture was canonicalized to `0` instead of IEEE `-0`.

## Executable evidence

```text
node --test tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 24/24 pass, 0 fail, exit 0, 1.313 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-crack-field.mjs` | `6630d938ab38c8bb7ffbc2fa5f944c5da022c780` | `811A12A57693CAF920D9B956DD8A7551B04EAA38744D804A0B84F3C47E0F7219` |
| `tests/js/vf-road-crack-field.test.mjs` | `ae09008b24a9d2ac69d6130a978ae18495e9943b` | `E9163C0C2CE94D4E1B2A8DF09C55A2E091200FF5F208380663A0CA554C38B3EA` |

## Acceptance and recovery

MAT060D advances the road tracer from wear and construction layers to a
bounded crack truth shared by geometry and PBR appearance. It does not yet
establish connected crack topology, refinement, markings, repairs, dirt, snow,
edge breakdown, renderer consumption, CPU/WGSL/native parity, research-fitted
presets, public controls, or release integration.

Re-evaluated estimated 0.6.0 completion is **59.1%**, up **0.4 percentage
points** from MAT060C's 58.7%. Recovery is `git revert` of this packet commit;
only the private crack oracle, focused test, and this receipt are owned.
