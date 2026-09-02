# 0.6.0 MAT060G — road dirt-field evidence

## Scope

- Base: `4f4a4594` (`MAT060F`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road dirt-field reference oracle and focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires dirt and water response to follow traffic, drainage/exposure,
and road position while geometry and appearance share one field truth. MAT060G
combines MAT060A lateral coordinates, MAT060B traffic/wetness, and a separately
keyed correlated debris field. One bounded accumulation drives deposit height,
albedo, roughness, and retained wetness.

Road-width thresholds, debris color, and material coefficients are synthetic
acceptance values, not public defaults or measured pavement claims. Research
provenance, fitted presets, target lowering, and author controls remain
separate release work. This JavaScript module is a private correctness oracle,
not a product-runtime dependency or package export.

## Observable behavior

Four demanded cells cover the road center, both exposed surface edges, and one
buried edge layer. Only the surface edges accumulate dirt. One shared
accumulation buffer raises deposited geometry, darkens albedo, increases
roughness, and retains water. Center and buried PBR samples remain bit-identical
to MAT060B.

Wear and dirt identities use separate hierarchy branches, so changing debris
identity cannot regenerate traffic/exposure. The result owns 128 vector bytes
for debris driver, accumulation, deposit height, RGB albedo, roughness, and
wetness. Coordinate buffers remain borrowed. A four-sample budget leaves the
fifth requested cell and the remaining 299,999,999,995 potential road cells
unrealized.

## RED / GREEN

- Baseline `4f4a4594`: MAT060A-F, conditioned-distribution, and spatial-field
  suites passed 28/28 (exit 0, 1.465 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because `vf-road-dirt-field.mjs` did not
  exist (exit 1, 0.378 s).
- GREEN: pinned dirt geometry/PBR behavior and malformed-demand rejection
  passed 2/2 as part of the focused regression command below.

## Executable evidence

```text
node --test tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 30/30 pass, 0 fail, exit 0, 1.624 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-dirt-field.mjs` | `aa3f275ce3a0141fb1888663ea161bacb0f5f279` | `56F271F7A2F8DEE43D89BBD48C138109827C8EB1C254B8D310CB15A0BBEBAE9C` |
| `tests/js/vf-road-dirt-field.test.mjs` | `cc4e8c7988f9b28b678454f5edb5f74aeb7865c9` | `8E9DB5960A865D2BA1E9F80ED7DD2AE6AA0AF638600548A8BC0A85AE53D0D481` |

## Acceptance and recovery

MAT060G advances the road tracer from construction/wear/cracks/repairs and
markings to one bounded dirt truth shared by geometry and PBR appearance. It
does not yet establish drainage geometry, snow, edge breakdown, renderer
consumption, CPU/WGSL/native parity, research-fitted presets, public controls,
or release integration.

Re-evaluated estimated 0.6.0 completion is **60.0%**, up **0.3 percentage
points** from MAT060F's 59.7%. Recovery is `git revert` of this packet commit;
only the private dirt oracle, focused test, and this receipt are owned.
