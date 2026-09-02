# 0.6.0 MAT060J — road water-field evidence

## Scope

- Base: `0571922f` (`MAT060I`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road standing-water reference oracle and focused
  test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires wetness to respond to traffic and exposure while geometry and
appearance remain one procedural truth. MAT060J combines MAT060A lateral
coordinates, MAT060B traffic/exposure/wetness, and a separately keyed
correlated pooling field. Lateral drainage, rut retention, rainfall exposure,
and local pooling determine one bounded standing-water buffer that drives
water depth, albedo, roughness, and wetness.

Drainage scale, rainfall/pooling weights, and material coefficients are
synthetic acceptance values, not public defaults or measured pavement claims.
Research provenance, fitted presets, target lowering, and author controls
remain separate release work. This module is a private correctness oracle, not
a product-runtime dependency or package export.

## Observable behavior

Four demanded cells cover the road center, both exposed surface edges, and one
buried edge layer. The center depression pools water while drained edge and
buried samples remain dry. One shared water coverage/depth truth changes
surface geometry and darkens, smooths, and wets its PBR response. The buried
PBR sample remains bit-identical to MAT060B.

Wear and water identities use separate hierarchy branches, so changing water
identity cannot regenerate traffic/exposure. The result owns 128 vector bytes
for pooling driver, coverage, depth, RGB albedo, roughness, and wetness.
Coordinate buffers remain borrowed. A four-sample budget leaves the fifth
requested cell and 299,999,999,995 potential cells unrealized.

## RED / GREEN

- Baseline `0571922f`: MAT060A-I, conditioned-distribution, and spatial-field
  suites passed 34/34 (exit 0, 1.190 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because `vf-road-water-field.mjs` did not
  exist (exit 1, 0.274 s).
- GREEN: pinned standing-water geometry/PBR behavior and malformed-demand
  rejection passed 2/2 as part of the focused regression command below.

## Executable evidence

```text
node --test tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 36/36 pass, 0 fail, exit 0, 1.663 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-water-field.mjs` | `ae9803347d1492197a25c37d36240c379f996240` | `EA0A3FE7BCAEB48B54D80DD050790B438AEED2436E66103A357F62A04117446B` |
| `tests/js/vf-road-water-field.test.mjs` | `6c7a7284d8d6c786139505d210b360347667de57` | `B528B36B14B202FBEE5C45FD5FDA3A660681B64C84BF7EEF72A1B2432214A7B1` |

## Acceptance and recovery

MAT060J advances the road tracer with one bounded standing-water truth shared
by geometry and PBR appearance. It does not yet establish explicit shoulders,
joints, connected refinement, renderer consumption, CPU/WGSL/native parity,
research-fitted presets, public controls, or release integration.

Re-evaluated estimated 0.6.0 completion is **60.9%**, up **0.3 percentage
points** from MAT060I's 60.6%. Recovery is `git revert` of this packet commit;
only the private water oracle, focused test, and this receipt are owned.
