# 0.6.0 MAT060F — road repair-field evidence

## Scope

- Base: `bdb8471e` (`MAT060E`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road repair-field reference oracle and focused
  test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires repairs to stay in the road coordinate frame and change shape
and appearance together. MAT060F consumes MAT060D crack coverage, evaluates a
separately keyed correlated maintenance field, and fills only demanded cracked
cells. One repair coverage drives the filled displacement and repaired albedo,
roughness, and wetness.

Patch color and material coefficients are synthetic acceptance values, not
public defaults or measured pavement claims. Research provenance, fitted
presets, target lowering, and author controls remain separate release work.
This JavaScript module is a private correctness oracle, not a product-runtime
dependency or package export.

## Observable behavior

Three demanded cells contain one cracked surface, one intact surface, and one
buried layer. Only the cracked surface receives repair coverage. Its depression
is filled toward the surface and its PBR response blends toward patch material.
The intact and buried geometry/PBR samples remain bit-identical to MAT060D.

Crack and repair identities are separate hierarchy branches, so changing
maintenance identity cannot regenerate the underlying crack field. The result
owns 108 vector bytes for maintenance driver, repair amount/coverage,
displacement, RGB albedo, roughness, and wetness. All coordinate buffers remain
borrowed. A three-sample budget leaves the fourth requested cell and the
remaining 11,999,999,996 potential road cells unrealized.

## RED / GREEN

- Baseline `bdb8471e`: MAT060A-E, conditioned-distribution, and spatial-field
  suites passed 26/26 (exit 0, 1.610 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because `vf-road-repair-field.mjs` did not
  exist (exit 1, 1.129 s).
- GREEN: pinned repair geometry/PBR behavior and malformed-demand rejection
  passed 2/2 as part of the focused regression command below. An intermediate
  test exposed conflated crack/repair identities; separate hierarchy branches
  fixed the source behavior rather than weakening the assertion.

## Executable evidence

```text
node --test tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 28/28 pass, 0 fail, exit 0, 1.185 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-repair-field.mjs` | `a8e0b3df0a90904f90a6c47b361d0bf5d1320659` | `B71AEC4B1E5F0C48F5FAA6E2D3481E703A589948080AE6DAB0D98F4C58235708` |
| `tests/js/vf-road-repair-field.test.mjs` | `3ed52a9386a9e7a52e6b62cc5abe51fab1116944` | `1D1B6E3B720F62CC792178808DB5226CD9FEA4AC7ED15E711000A9E615383C2F` |

## Acceptance and recovery

MAT060F advances the road tracer from wear/cracks/markings to one bounded
repair truth shared by geometry and PBR appearance. It does not yet establish
repair topology/refinement, dirt, snow, edge breakdown, renderer consumption,
CPU/WGSL/native parity, research-fitted presets, public controls, or release
integration.

Re-evaluated estimated 0.6.0 completion is **59.7%**, up **0.3 percentage
points** from MAT060E's 59.4%. Recovery is `git revert` of this packet commit;
only the private repair oracle, focused test, and this receipt are owned.
