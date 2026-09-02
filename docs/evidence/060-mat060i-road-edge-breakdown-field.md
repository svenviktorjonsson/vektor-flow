# 0.6.0 MAT060I — road edge-breakdown evidence

## Scope

- Base: `6850c562` (`MAT060H`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road edge-breakdown reference oracle and focused
  test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 calls for edge breakdown to respond to road position, load, and
exposure while shape and appearance share one procedural truth. MAT060I
combines MAT060A lateral coordinates, MAT060B traffic/exposure, and a separately
keyed correlated erosion field. One bounded edge-integrity buffer drives
recession, displacement, albedo, roughness, and wetness.

Road-width thresholds, erosion scale, and material coefficients are synthetic
acceptance values, not public defaults or measured pavement claims. Research
provenance, fitted presets, target lowering, and author controls remain
separate release work. This module is a private correctness oracle, not a
product-runtime dependency or package export.

## Observable behavior

Four demanded cells cover the road center, both exposed surface edges, and one
buried edge layer. Only surface edges lose integrity and recede. One shared
integrity buffer drives negative displacement and exposed-aggregate PBR
response. Center and buried PBR samples remain bit-identical to MAT060B.

Wear and erosion identities use separate hierarchy branches, so changing edge
identity cannot regenerate traffic/exposure. The result owns 144 vector bytes
for erosion driver, integrity, recession, displacement, RGB albedo, roughness,
and wetness. Coordinate buffers remain borrowed. A four-sample budget leaves
the fifth requested cell and 299,999,999,995 potential cells unrealized.

## RED / GREEN

- Baseline `6850c562`: MAT060A-H, conditioned-distribution, and spatial-field
  suites passed 32/32 (exit 0, 2.054 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because
  `vf-road-edge-breakdown-field.mjs` did not exist (exit 1, 0.541 s).
- GREEN: pinned edge geometry/PBR behavior and malformed-demand rejection
  passed 2/2 as part of the focused regression command below.

## Executable evidence

```text
node --test tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 34/34 pass, 0 fail, exit 0, 1.485 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-edge-breakdown-field.mjs` | `9281912791c3185a0a71aa2a50944f68460074bb` | `F3EB8F0DDD48F4A3CE3681E22D5E1A232F3CC54A56130941F3B5F4FE2232982B` |
| `tests/js/vf-road-edge-breakdown-field.test.mjs` | `8b3ff0decbdb05d5c7bda77a2707d9486d7c79d0` | `280855F83B732D1EE1528DC4D9378D73CFF0DC1900562A7AB8D03CB317426864` |

## Acceptance and recovery

MAT060I advances the road tracer with one bounded edge-breakdown truth shared
by geometry and PBR appearance. It does not yet establish shoulder geometry,
drainage, joints, connected refinement, renderer consumption,
CPU/WGSL/native parity, research-fitted presets, public controls, or release
integration.

Re-evaluated estimated 0.6.0 completion is **60.6%**, up **0.3 percentage
points** from MAT060H's 60.3%. Recovery is `git revert` of this packet commit;
only the private edge oracle, focused test, and this receipt are owned.
