# 0.6.0 MAT060O — road wear renderer-packet evidence

## Scope

- Base: `eca94b67` (`MAT060N`).
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Adds one private retained construction-plus-wear renderer adapter and focused
  test.
- No public VKF syntax, constructor, API, schema, ABI, package export, shader,
  gallery, fixture, media, or 0.4/0.5 path changes.

## Plan fit

MAT-060 requires the same traffic/exposure fields to affect road geometry and
appearance. MAT060O consumes MAT060N's aggregate/binder `field_mesh` packets
and MAT060B's deterministic wear field. Construction composition remains the
base; traffic/exposure adds displacement, darkening, polished roughness,
wetness, and specular response to the same retained renderer packet.

The composition weights remain synthetic acceptance values, not public
defaults or measured pavement claims. Later cracks, repairs, markings, dirt,
water, snow, ruts, and shoulders are deliberately not ordered or blended by
this private slice.

## Observable behavior

Two construction packets become two 232-byte construction-plus-wear packets.
Each preserves triangle indices and aggregate/binder/void truth while packing
traffic/exposure drivers, wear displacement, construction-aware albedo,
roughness, wetness, and specular strength. Geometry lowers along the existing
normal and packed vertex color equals the final albedo channel exactly.

The first upload is exactly 464 bytes. Reversed demand order retains both
packet objects and uploads zero bytes. One packet pins the final position,
normal, RGB, traffic/exposure drivers, roughness, displacement, wetness, and
specular response. Private provenance rejects forged and cross-wear-field
retained states.

## RED / GREEN

- Baseline `eca94b67`: MAT060A-N, conditioned-distribution, and spatial-field
  suites passed 44/44 (exit 0, 1.279 s) on Node.js 24.11.0 / Windows x64.
- RED 1: the focused behavior failed only because
  `vf-road-wear-renderer-packets.mjs` did not exist (exit 1, 0.267 s).
- GREEN 1: construction/wear composition and zero-upload retention passed 1/1
  (exit 0, 0.352 s).
- RED 2: the existing behavior stayed green while forged-state rejection
  produced an uncontracted internal TypeError (1/2 pass, exit 1, 0.328 s).
- GREEN 2: wear packet composition and explicit provenance passed 2/2 (exit 0,
  0.397 s).

## Executable evidence

```text
node --test tests/js/vf-road-wear-renderer-packets.test.mjs tests/js/vf-road-construction-renderer-packets.test.mjs tests/js/vf-road-refinement-working-set.test.mjs tests/js/vf-road-shoulder-field.test.mjs tests/js/vf-road-rut-field.test.mjs tests/js/vf-road-water-field.test.mjs tests/js/vf-road-edge-breakdown-field.test.mjs tests/js/vf-road-snow-field.test.mjs tests/js/vf-road-dirt-field.test.mjs tests/js/vf-road-repair-field.test.mjs tests/js/vf-road-marking-field.test.mjs tests/js/vf-road-crack-field.test.mjs tests/js/vf-road-construction-field.test.mjs tests/js/vf-road-wear-field.test.mjs tests/js/vf-road-coordinate-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs
```

- 46/46 pass, 0 fail, exit 0, 1.350 s.
- `git diff --check` is clean.
- The packet verifies deterministic numeric renderer buffers but does not own a
  scene/frame invocation, so offscreen capture does not apply yet.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-road-wear-renderer-packets.mjs` | `2581c1c778bd9a50808333084d90ae29341a0868` | `52044164C363E7E52558C93054F6007E50995C76F935A9BE65AE4B8F80F5DFC3` |
| `tests/js/vf-road-wear-renderer-packets.test.mjs` | `2f9edcbdbc09627f5c9feeeaac7e2dea606dc3dc` | `AEBBE60A63A0205A09973CB5784BC42339BD484C51A9C6DC8F5C27E8226E5C94` |

## Acceptance and recovery

MAT060O establishes retained construction-plus-traffic/exposure packets in the
renderer material model. It does not yet compose later road effects, invoke a
retained scene/frame, select demand from projected error, prove connected
boundaries, compile CPU/WGSL/native parity, or provide research-fitted presets
and public controls.

Re-evaluated estimated 0.6.0 completion is **63.1%**, up **0.5 percentage
points** from MAT060N's 62.6%. Recovery is `git revert` of this packet commit;
only the private wear adapter, focused test, and this receipt are owned.
