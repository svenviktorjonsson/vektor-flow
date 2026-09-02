# 0.6.0 MAT060L — road shoulder-field evidence

## Scope

- Base: `7ba66e57` (`MAT060K`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road-shoulder reference oracle and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

The initial 0.6 road model calls for shoulders in the road coordinate frame,
with load-conditioned shape and appearance. MAT060L combines MAT060A lateral
coordinates, MAT060B traffic, an edge profile, and a separately keyed
correlated compaction field. One bounded shoulder state drives lowered geometry
and gravel-like albedo, roughness, and wetness.

Shoulder width, drop, compaction, and material coefficients are synthetic
acceptance values, not public defaults or measured pavement claims. Research
provenance, fitted presets, target lowering, and author controls remain
separate release work. This module is a private correctness oracle, not a
product-runtime dependency or package export.

## Observable behavior

Four demanded cells cover the paved center, both surface shoulders, and one
buried shoulder layer. Only surface edge cells become shoulder material. One
shared shoulder-state buffer lowers those cells and changes their PBR response.
Center and buried PBR samples remain bit-identical to MAT060B.

Wear and shoulder identities use separate hierarchy branches, so changing
shoulder identity cannot regenerate traffic/exposure. The result owns 128
vector bytes for compaction driver, shoulder state, displacement, RGB albedo,
roughness, and wetness. Coordinate buffers remain borrowed. A four-sample
budget leaves the fifth requested cell and 299,999,999,995 potential cells
unrealized.

## RED / GREEN

- Baseline `7ba66e57`: MAT060A-K, conditioned-distribution, and spatial-field
  suites passed 38/38 (exit 0, 1.606 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused behavior failed only because
  `vf-road-shoulder-field.mjs` did not exist (exit 1, 0.370 s).
- GREEN 1: surface shoulder geometry/PBR behavior passed 1/1 (exit 0, 0.501 s).
- RED 2: the existing behavior stayed green and the new upper-budget rejection
  failed with a missing expected exception (1/2 pass, exit 1, 0.372 s).
- GREEN 2: pinned shoulder behavior and malformed-demand rejection passed 2/2
  (exit 0, 0.340 s).

## Executable evidence

```text
node --test tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 40/40 pass, 0 fail, exit 0, 1.572 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-shoulder-field.mjs` | `856519b3ede074a8f4884ad5e04fc0f3bd257944` | `D2A8EF6AEEF414E82DF30488C5080ACC123C7A5A88E0BF9435B47A926094EE7C` |
| `tests/js/vf-road-shoulder-field.test.mjs` | `d017b59737277e69fc36767a87dd92d8a7ecc4e0` | `7847D02C73AB19E8193884AC3F069102FC26D828998BBBEAE4C086B8B45332BE` |

## Acceptance and recovery

MAT060L adds the missing bounded shoulder component to the private road-frame
model, sharing one state between geometry and PBR appearance. It does not yet
establish connected refinement, renderer consumption, CPU/WGSL/native parity,
research-fitted presets, public controls, or release integration.

Re-evaluated estimated 0.6.0 completion is **61.5%**, up **0.3 percentage
points** from MAT060K's 61.2%. Recovery is `git revert` of this packet commit;
only the private shoulder oracle, focused test, and this receipt are owned.
