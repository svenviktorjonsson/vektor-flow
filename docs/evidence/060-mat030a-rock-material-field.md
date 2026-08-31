# MAT030A procedural rock material field evidence

Date: 2026-08-31

## Packet

- Base: `e7f1831bcca418d30cf0d5455adec16633f3786e`
- Branch: `codex/0.6/060-mat030a-rock-material-field`
- Scope: internal deterministic geology/weathering field, correlated rock material channels, and an adapter into existing retained renderer packets.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-rock-material-field.mjs`
  - `tests/js/vf-rock-material-field.test.mjs`
  - `tests/fixtures/rock-material-field-smoke.html`
  - `docs/evidence/060-mat030a-rock-material-field.md`

## Observable contract

- One immutable conditioned demand identity drives every channel through a shared six-octave geology/weathering signal. Sampling does not allocate a surface grid or work proportional to unrealized detail.
- Stable ellipsoid surface coordinates use the normalized ellipsoid direction and an octahedral 2D mapping. Radially equivalent points therefore address the same material sample.
- Base color, roughness, displacement, and tangent-space normal are deterministic functions of the same scalar signal. The pinned sample has geology `0.1157007647847343`, derivative `[-2.352305242111219, -2.107711252649358]`, and tangent normal `[0.36808735109403024, 0.3298134264082471, 0.8693300901990175]`.
- Derivatives use a pinned central finite-difference reference with step `1e-4`.
- Footprint filtering suppresses octaves that cannot be represented at the requested detail. At footprint `0.5`, detail levels zero and five are exactly equal. The implementation evaluates at most six octaves even for `Number.MAX_SAFE_INTEGER` detail.
- Samples are unchanged by traversal order, chunk boundaries, recreated field objects with the same identity, and unrelated distant queries.
- The internal renderer adapter preserves packet/object identity, index data, and the source packet. It writes displaced positions, perturbed normals, and correlated color into the existing ten-float field-mesh vertex layout, exposes bounded per-vertex roughness/displacement/coordinate sidecars, and maps mean roughness to the existing scalar specular strength.
- Shared coarse/refined vertices produce byte-identical filtered material values when evaluated at the same footprint.

## RED to GREEN

1. The initial shared-field test failed because `vf-rock-material-field.mjs` did not exist. `8b68acc` added the smallest deterministic field and correlated channels.
2. Derivative and filtered-detail tests pinned the numerical oracle and level-of-detail seam. `ad457d5` returned them to green.
3. The retained-packet test failed because the material adapter export did not exist. `63fc42b` added the internal adapter while preserving existing packet identity and layout.
4. `04aca8e` added a real off-screen WebGPU fixture using one coarse and two demanded detail packets.
5. The final robustness cycle pinned stable ellipsoid coordinates and rejected malformed, non-finite, or unbounded demand. `db1f671` returned all seven focused tests to green.

## Executable evidence

Focused material suite:

```text
node --test tests/js/vf-rock-material-field.test.mjs
tests 7; pass 7; fail 0
```

Affected deterministic geometry/material/renderer chain:

```text
node --test tests/js/vf-spatial-correlation.test.mjs tests/js/vf-demand-refined-geometry.test.mjs tests/js/vf-refinement-working-set.test.mjs tests/js/vf-rock-renderer-packets.test.mjs tests/js/vf-rock-material-field.test.mjs tests/js/vf-geom-render-evidence.test.cjs
tests 40; pass 40; fail 0
```

Real GPU capture, launched only through the existing Edge `--headless=new` helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html tests/fixtures/rock-material-field-smoke.png 0 9366 rock_material_field_frame
```

Observed capture evidence:

- WebGPU initialized off-screen at 1236 x 725 with no initialization or runtime failures.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 69426.
- The live provider and renderer both held exactly three parts: coarse 60/24 vertex-value/index counts and two detail parts of 40/9 each.
- Frame sequence and adapter revision both reached `2`.
- The transient 52,053-byte PNG had SHA-256 `4FCE8E994C00D6AAEB8C5D8C12003DDFC64547A0024ABFA5CC7940C2466D8593`, was visually checked for a closed lit brown rock, and was removed. No generated binary remains.

Repository suite:

```text
npm test
tests 462; pass 459; fail 3
```

The same three base/integration failures remain outside owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-rock-material-field.mjs` | `dba1fc4927ea4176083197c1698b4dd27c8fe687` | `B2E9D764D52924DCDFDC3ABD72AE4DEAAF75BC892392EA80D44465152AB1E235` |
| `tests/js/vf-rock-material-field.test.mjs` | `f0f003df75627395500dde934f1eb17dd111d7ed` | `20566AF7CC2CA77ABE04B4DAAC81E5359C5840EA8232BDE9A90146E202F52A80` |
| `tests/fixtures/rock-material-field-smoke.html` | `a068280cbd5e3f89d35f0f08a65998909b537189` | `109733FA4563243462BD93D465AA658DF80D8BB49C5D196DA2C9418703B73B01` |

## Remaining boundary

The existing renderer consumes baked per-vertex position, normal, and color plus packet-level specular strength. Per-vertex roughness and displacement remain internal sidecars rather than a fragment-stage GPU material graph. The octahedral surface chart also has its normal negative-pole/chart-edge seam, while identical shared vertices remain stable. A later internal packet can move these same deterministic channels into per-fragment GPU evaluation without changing public VKF contracts.

Recovery: drop commits after base `e7f1831` on this packet branch; no other worktree is required.
