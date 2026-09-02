# 0.6.0 MAT060C — road construction-field evidence

## Scope

- Base: `d7c5e8d4` (latest isolated 0.6 lane head).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road construction-field reference oracle and its
  focused test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires aggregate, binder, construction layers, geometry, and
appearance to share one road coordinate truth. MAT060C consumes MAT060A's
bounded coordinates and realizes deterministic composition, relief, albedo,
and roughness for only the demanded cells. Aggregate and binder use separately
keyed spatially correlated fields, while the construction-layer index selects
the coarse mixture profile.

The profiles are synthetic acceptance values, not measured asphalt claims.
Research provenance, fitted presets, target lowering, and public author
controls remain separate release work. This JavaScript module is a private
correctness oracle, not a product-runtime dependency or package export.

## Observable behavior

Three demanded cells at one longitudinal/lateral position span surface, base,
and subbase layers. They borrow one coordinate buffer, preserve their layer
indices, and deterministically produce aggregate, binder, and void fractions
whose sum is one. The same composition drives geometry displacement and PBR
albedo/roughness.

The result owns 120 vector bytes for six correlation drivers, displacement,
three composition channels, RGB albedo, and roughness. Coordinates, world
positions, and layer indices remain borrowed from MAT060A and are not copied
or counted. A three-sample budget leaves the fourth demanded cell and the
remaining 11,999,999,996 potential road cells unrealized.

## RED / GREEN

- Baseline `d7c5e8d4`: MAT060A/B, conditioned-distribution, and spatial-field
  suites passed 20/20 (exit 0, 1.208 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because
  `vf-road-construction-field.mjs` did not exist (exit 1, 0.516 s).
- GREEN: pinned layered composition, memory bounds, and malformed-demand
  behavior passed 2/2 as part of the focused regression command below.

## Executable evidence

```text
node --test tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 22/22 pass, 0 fail, exit 0, 1.002 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-construction-field.mjs` | `df29dc5939bbc55ccbf3a2d9f84bb37d3d79b8cb` | `21E081BEC099C1A53AF77BF6C6602A08906FF2FF032F5A0FC780F3191C5ADEA8` |
| `tests/js/vf-road-construction-field.test.mjs` | `abb208780e38eb88f7ed4dfb5c0939750a6c9827` | `FF652886446436BE71EE03E4F8703CA3096E577934D3C20FB5F317A781030A81` |

## Acceptance and recovery

MAT060C advances the road tracer from wear-only material response to one
bounded layered aggregate/binder composition truth shared by geometry and PBR
appearance. It does not yet establish cracks, markings, repairs, dirt, snow,
edge breakdown, renderer consumption, CPU/WGSL/native parity, research-fitted
presets, public controls, or release integration.

Re-evaluated estimated 0.6.0 completion is **58.7%**, up **0.4 percentage
points** from the latest 58.3% lane report. Recovery is `git revert` of this
packet commit; only the private construction oracle, focused test, and this
receipt are owned.
