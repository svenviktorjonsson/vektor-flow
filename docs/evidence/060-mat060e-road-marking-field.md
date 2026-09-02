# 0.6.0 MAT060E — road marking-field evidence

## Scope

- Base: `44738b74` (`MAT060D`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one synthetic private road marking-field reference oracle and focused
  test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  renderer entrypoint, gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires markings to share the road coordinate frame and respond to
traffic/exposure. MAT060E evaluates one internal dashed-center pattern directly
from MAT060A coordinates, then conditions paint retention on MAT060B wear plus
a separately keyed correlated flake field. The retained coverage drives paint
height and PBR appearance together.

Pattern dimensions, paint color, and material coefficients are synthetic
acceptance values, not public defaults or measured pavement claims. Research
provenance, fitted presets, target lowering, and author controls remain
separate release work. This JavaScript module is a private correctness oracle,
not a product-runtime dependency or package export.

## Observable behavior

Four demanded cells cover a painted dash, its longitudinal gap, an off-line
surface cell, and the same painted coordinate in a buried layer. Only the first
cell retains paint. One shared paint-coverage buffer drives raised geometry,
brighter albedo, roughness, and wetness, while every unpainted PBR sample is
bit-identical to MAT060B.

The result owns 128 vector bytes for flake driver, coverage, height, RGB albedo,
roughness, and wetness. Coordinates, world positions, and layer indices remain
borrowed from MAT060B and are not copied or counted. A four-sample budget leaves
the fifth requested cell and the remaining 299,999,999,995 potential road cells
unrealized.

## RED / GREEN

- Baseline `44738b74`: MAT060A-D, conditioned-distribution, and spatial-field
  suites passed 24/24 (exit 0, 2.090 s) on Node.js 24.11.0 / Windows x64.
- RED: the focused test failed only because `vf-road-marking-field.mjs` did not
  exist (exit 1, 0.564 s).
- GREEN: pinned paint geometry/PBR behavior and malformed-demand rejection
  passed 2/2 as part of the focused regression command below.

## Executable evidence

```text
node --test tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 26/26 pass, 0 fail, exit 0, 1.291 s.
- `git diff --check` is clean.
- The packet contains only a private reference oracle, focused test, and this
  receipt, so deterministic offscreen capture does not apply.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-marking-field.mjs` | `aef1756bfa534c559b129c9a26e483623c502f11` | `AFE9F299A5876DD1E10DAE2686772EF66C99E497217365AD771FBA841CF43209` |
| `tests/js/vf-road-marking-field.test.mjs` | `a508c031f7178990afe7859755c73e07d808f1cc` | `90BCBDE15C678BC2AD33AE730EF4C46DE4A5169E452DB0CC0A4D8B267BE7F29D` |

## Acceptance and recovery

MAT060E advances the road tracer from construction/wear/cracks to one bounded
worn-marking truth shared by geometry and PBR appearance. It does not yet
establish multiple marking patterns, connected refinement, repairs, dirt,
snow, edge breakdown, renderer consumption, CPU/WGSL/native parity,
research-fitted presets, public controls, or release integration.

Re-evaluated estimated 0.6.0 completion is **59.4%**, up **0.3 percentage
points** from MAT060D's 59.1%. Recovery is `git revert` of this packet commit;
only the private marking oracle, focused test, and this receipt are owned.
