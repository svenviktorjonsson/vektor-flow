# MAT030B per-fragment GPU rock material evidence

Date: 2026-08-31

## Packet

- Base: `1dc6b1e3f9df3827164f4e2b20d95f094b585055`
- Branch: `codex/0.6/060-mat030b-gpu-material-field`
- Scope: internal WGSL parity reference and retained-renderer path for filtered per-fragment rock material evaluation.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-conditioned-distribution.mjs`
  - `web/vf-ui/vf-rock-material-gpu.mjs`
  - `web/vf-ui/vf-rock-material-field.mjs`
  - `web/vf-ui/geom/vf-geom-wgpu.js`
  - `web/vf-ui/vf-display.js`
  - `tests/js/vf-rock-material-gpu.test.mjs`
  - `tests/js/vf-display-rock-material-pass-through.test.cjs`
  - `tests/fixtures/rock-material-gpu-parity-smoke.html`
  - `tests/helpers/run_headless_webgpu_fixture.cjs`
  - `docs/evidence/060-mat030b-gpu-material-field.md`

## Observable contract

- The CPU conditioned identity exposes exactly four immutable u32 stream words. The GPU evaluates the same established Philox4x32-10 counter construction, quintic value-noise lattice, and bounded six-octave geology/weathering field from those words.
- A compact internal renderer descriptor explicitly carries generator stream, radii, detail level, minimum footprint, and the six-octave cap without allocating a texture, surface grid, or unrealized samples.
- Fragment coordinates are the stable ellipsoid surface coordinates already owned by MAT030A. The main receiver shader derives their screen footprint with `dpdx`/`dpdy`, filters unresolved octaves, and evaluates correlated base color, roughness, displacement derivative, and tangent normal per pixel.
- Roughness remains clamped to `[0.58, 0.92]`; displacement remains clamped to `[-0.08, 0.08]`; the tangent normal is normalized. Per-fragment specular energy is scaled by `0.34 * (1 - roughness)^2` before the existing direct-light path.
- Ordinary opaque/transparent material pipelines are unchanged. A rock packet selects a dedicated layout containing stable surface coordinates, baked geometric displacement, and the undisplaced base normal.
- `VfDisplay` passes the internal descriptor and typed channel sidecars through normalization by reference. Renderer reuse continues to key on existing object/packet identity, updates only the bounded material vertex buffer, and destroys it with the retained part.

## RED to GREEN

1. The first focused test failed because no GPU descriptor or WGSL rock-field reference existed. `c52c1f4` added the compact deterministic reference and pinned CPU output records.
2. Channel-specific numerical-bound tests failed before a verifier existed. `d56f11b` added finite lane validation with tighter scalar/color and energy bounds plus explicit derivative/normal tolerances.
3. The executable fixture contract failed before a real WebGPU path existed. `960f713` added the headless compute fixture and readback verifier.
4. Retained packet identity tests failed because the material adapter emitted only baked channels. `b11df30` attached the immutable GPU field descriptor without changing packet/object/index identity.
5. The main renderer source contract and first capture showed no material buffers: normalized field meshes had stripped the internal sidecars. A dedicated regression reproduced `built.rock_material_gpu === undefined`; `4a890e5` preserved the sidecars and added the real fragment pipeline. The committed-head capture then reported material buffers of 144, 96, and 96 bytes for the unchanged three retained parts.

## Executable evidence

Focused affected chain:

```text
node --test tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-rock-material-gpu.test.mjs tests/js/vf-rock-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-rock-renderer-packets.test.mjs tests/js/vf-refinement-working-set.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-clustered-light-shader.test.mjs tests/js/vf-geom-render-evidence.test.cjs
tests 51; pass 51; fail 0
```

Real CPU/GPU numerical parity, launched only through Edge `--headless=new`:

```text
node tests/helpers/run_headless_webgpu_fixture.cjs tests/fixtures/rock-material-gpu-parity-smoke.html "window.__rockMaterialGpuParityEvidence || null" 9383
outcome pass; records 3; maxAbsoluteError 0.00024956464767456055; maxOctaves 6
streamWords [3982524626, 2941269488, 3065520907, 1471304979]
```

Committed-head renderer capture, also headless/off-screen only:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html tests/fixtures/rock-material-gpu-frame.png 0 9385 rock_material_field_frame
```

Observed capture evidence:

- WebGPU initialized at 1236 x 725 with no initialization, shader-compilation, or runtime failures.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- The live provider and renderer retained exactly three existing parts with frame/adapter revision `2`.
- All parts selected the rock material path, with bounded material buffers of 144, 96, and 96 bytes.
- The renderer also retained one planned clustered light and 3,456 bounded cluster assignments without overflow.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, was visually checked for a closed lit brown rock, and was removed. No generated binary remains.

Repository suite:

```text
npm test
tests 468; pass 465; fail 3
```

The same three base/integration failures remain outside owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-conditioned-distribution.mjs` | `1bc6415f0d3afb2be71331c502258a62b054d943` | `8177852F435B7A651CD7ED6F5A09113EBBC8D55944F6D60D97BCD05BDD88C7B8` |
| `web/vf-ui/vf-rock-material-gpu.mjs` | `c55638139b541d48fa3fd456ea832ebdfa5a8cdb` | `8149D4AAAB5F80EA681900C854C8BFC7BBF222478EC129FD50DF59CA21D8E810` |
| `web/vf-ui/vf-rock-material-field.mjs` | `99fb01aaa155d7f3a7029f76e36abcda93d4a601` | `0674B5BFC8A110182DCFF2B0FA5716939CE18CAF2469C499BE6BE4EC436F0904` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `b1fee404b3722a54dcd3bf22894b675283a81525` | `84D630420B4A08056C08743A71954708B63F318213DB91FE16C3A206B74D7D32` |
| `web/vf-ui/vf-display.js` | `d29cea5e993b35c029ed2b09563d2b3e2534a98a` | `E5E4A70C26E8B8E474A87BB4AB74A166B41ECADB22B4F6852C450225D7D60057` |
| `tests/js/vf-rock-material-gpu.test.mjs` | `ae957ba4b0b7cdbc38eb91b084160b77d9f08641` | `6CB607108C90C9E51D74371FD518E5BEB52C4965D9CFF702184BB1C60F722FD7` |
| `tests/js/vf-display-rock-material-pass-through.test.cjs` | `efbe4236756b31e451ef8a3293dbb48c1f8c2caa` | `235A106B8D9355C1783CCCF2AF244F872C79FAB02255488A84C27EE982771E0F` |
| `tests/fixtures/rock-material-gpu-parity-smoke.html` | `024b1f9a16e75e08274906cf415bafaf4ba9e763` | `22830E8B44BF12331FC4B387D618DF0AF6DD5F51063DC5EB9F6AAD4FB27F8551` |
| `tests/helpers/run_headless_webgpu_fixture.cjs` | `eb6f6471c25335fdb3d363d617ad754e940b3d56` | `F92BB3BFC0ABB1CF8C5F471929508338F0B8AE10F67D62F052D03E4BA5D962D4` |

## Remaining boundary

Geometric displacement still occurs at demanded vertices, so this slice does not add fragment microdisplacement to the silhouette. Fragment evaluation now owns filtered color, roughness, and displacement-derived normal shading; later refinement/tessellation or ray-intersection work can move silhouette displacement without changing this internal field identity. The inherited octahedral coordinate chart still has its negative-pole/chart-edge seam.

Recovery: drop commits after base `1dc6b1e` on this packet branch; no other worktree is required.
