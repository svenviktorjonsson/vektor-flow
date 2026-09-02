# 0.6.0 MAT060K — road rut-field evidence

## Scope

- Base: `ff5aaa5c` (`MAT060J`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private traffic-rut reference oracle and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 calls for rutting to respond to load paths while geometry and material
appearance share one wear truth. MAT060K combines MAT060A lateral coordinates,
MAT060B traffic, a deterministic wheel-path profile, and a separately keyed
correlated continuity field. One bounded rut-intensity/depth truth drives road
depression, albedo, polished roughness, and retained wetness.

Wheel position/width, depth scale, and material coefficients are synthetic
acceptance values, not public defaults or measured pavement claims. Research
provenance, fitted presets, target lowering, and author controls remain
separate release work. This module is a private correctness oracle, not a
product-runtime dependency or package export.

## Observable behavior

Four demanded cells cover both surface wheel paths, the undriven road center,
and one buried wheel-path layer. Only surface wheel paths rut. One shared
intensity/depth buffer depresses geometry and darkens, smooths, and wets PBR
appearance. Center and buried PBR samples remain bit-identical to MAT060B.

Wear and rut identities use separate hierarchy branches, so changing rut
identity cannot regenerate traffic/exposure. The result owns 144 vector bytes
for continuity driver, intensity, depth, displacement, RGB albedo, roughness,
and wetness. Coordinate buffers remain borrowed. A four-sample budget leaves
the fifth requested cell and 299,999,999,995 potential cells unrealized.

## RED / GREEN

- Baseline `ff5aaa5c`: MAT060A-J, conditioned-distribution, and spatial-field
  suites passed 36/36 (exit 0, 1.279 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused behavior failed only because `vf-road-rut-field.mjs` did
  not exist (exit 1, 0.394 s).
- GREEN 1: wheel-path geometry/PBR behavior passed 1/1 (exit 0, 1.184 s).
- RED 2: the existing behavior stayed green and the new upper-budget rejection
  failed with a missing expected exception (1/2 pass, exit 1, 0.361 s).
- GREEN 2: pinned rut behavior and malformed-demand rejection passed 2/2 (exit
  0, 0.342 s).

## Executable evidence

```text
node --test tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 38/38 pass, 0 fail, exit 0, 3.054 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-rut-field.mjs` | `847afb89bcaca4c13d34d66a17ff305122e2980a` | `4CAAF9B2528E6BDD7EE4AC05D62AF7E2AA09A7559A9EFFEF15611FDD796875B2` |
| `tests/js/vf-road-rut-field.test.mjs` | `76efecbac51110e8bc32045adbb9b4fe598a9aa0` | `D9F4F01DE2C3F8F5A67E1BCAC8D83A16EF7467E326C80D036F53CF26A65B5825` |

## Acceptance and recovery

MAT060K advances the road tracer with bounded traffic rutting shared by
geometry and PBR appearance. It does not yet establish explicit shoulders,
joints, connected refinement, renderer consumption, CPU/WGSL/native parity,
research-fitted presets, public controls, or release integration.

Re-evaluated estimated 0.6.0 completion is **61.2%**, up **0.3 percentage
points** from MAT060J's 60.9%. Recovery is `git revert` of this packet commit;
only the private rut oracle, focused test, and this receipt are owned.
