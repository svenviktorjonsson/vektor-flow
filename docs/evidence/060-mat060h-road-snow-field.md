# 0.6.0 MAT060H — road snow-field evidence

## Scope

- Base: `7486b722` (`MAT060G`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road snow-field reference oracle and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 calls for snow to respond to traffic, road position, and
climate/exposure while geometry and appearance remain one truth. MAT060H
combines MAT060A lateral coordinates, MAT060B traffic/exposure, and a separately
keyed correlated drift field. One bounded coverage drives snow depth, albedo,
roughness, and wetness.

The fixture assumes a snowy environment. Drift scale, snow color, and material
coefficients are synthetic acceptance values, not public defaults, a weather
simulation, or measured snow claims. Research provenance, fitted presets,
target lowering, and author controls remain separate release work. This module
is a private correctness oracle, not a product-runtime dependency or export.

## Observable behavior

Four demanded cells cover the road center, both surface edges, and one buried
edge layer. Traffic reduces center coverage while edge position and correlated
drift increase depth on both shoulders. One shared snow-coverage buffer raises
geometry, brightens albedo, changes roughness, and retains meltwater. The
buried PBR sample remains bit-identical to MAT060B.

Wear and snow identities use separate hierarchy branches, so changing drift
identity cannot regenerate traffic/exposure. The result owns 128 vector bytes
for drift driver, coverage, depth, RGB albedo, roughness, and wetness.
Coordinate buffers remain borrowed. A four-sample budget leaves the fifth
requested cell and the remaining 299,999,999,995 potential cells unrealized.

## RED / GREEN

- Baseline `7486b722`: MAT060A-G, conditioned-distribution, and spatial-field
  suites passed 30/30 (exit 0, 1.437 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because `vf-road-snow-field.mjs` did not
  exist (exit 1, 0.448 s).
- GREEN: pinned snow geometry/PBR behavior and malformed-demand rejection
  passed 2/2 as part of the focused regression command below.

## Executable evidence

```text
node --test tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 32/32 pass, 0 fail, exit 0, 1.283 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-snow-field.mjs` | `a4ad01061971320bd92b4fe028c1af148506a4c5` | `E2B6AF66B9DEA1B8D239A179C3B06A27A5D827BBE04A3C19544E1F817B2735B3` |
| `tests/js/vf-road-snow-field.test.mjs` | `7797465cf8d82d9d4d4ecaef1cc11ae19bea9ff6` | `641BF017609D6598099D3D74418230B675A62DC5C1E22DCE59557CC0CAEF23D5` |

## Acceptance and recovery

MAT060H advances the road tracer with one bounded snow truth shared by
geometry and PBR appearance. It does not yet establish temperature/melt
dynamics, drainage geometry, edge breakdown, renderer consumption,
CPU/WGSL/native parity, research-fitted presets, public controls, or release
integration.

Re-evaluated estimated 0.6.0 completion is **60.3%**, up **0.3 percentage
points** from MAT060G's 60.0%. Recovery is `git revert` of this packet commit;
only the private snow oracle, focused test, and this receipt are owned.
