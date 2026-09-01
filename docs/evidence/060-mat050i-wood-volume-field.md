# MAT050I coherent wood-volume evidence

Date: 2026-09-01

## Packet

- Base: `a8f16bc6` (MAT050H).
- Branch: `codex/0.6/060-mat050i-wood-volume-field`.
- Scope: private deterministic multiscale volume sampling through coherent trunk/branch growth coordinates.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-wood-volume-field.mjs`, `tests/js/vf-wood-volume-field.test.mjs`, and this receipt.

## Internal contract

- World points transform through MAT050H segment origins, growth axes, and radial frames into one three-dimensional growth coordinate: radial U, radial V, and root-relative path distance.
- Cut-plane orientation is not part of field identity. Transverse and longitudinal cuts meeting at the same world point therefore receive the exact same cached volume sample.
- Trunk and branch records condition one tree-level field identity. At their shared attachment, path and radial coordinates agree and ring/ray/fiber/material results match.
- Three private procedural scales model a coarse periodic growth-ring signal, directional ray signal, and fine correlated fiber signal. All are deterministic functions of the conditioned tree identity and solid position.
- Detail level and sample footprint filter scales independently. A fully filtered query evaluates none of the three spatial fields and returns their analytic aggregate defaults.
- Output currently exposes internal ring, ray, fiber, density, RGBA base color, and roughness reference values. Exact sample records are retained in a 4,096-entry LRU cache; tree field state has a 4,096-tree LRU cap.
- These coefficients are an artist-authored plausibility oracle for execution/coherence work. They are not a measured species preset, anatomical accuracy claim, public wood constructor, or frozen material schema.

## RED to GREEN

1. `66ea582c` pinned identical samples where transverse and longitudinal cuts intersect; it failed because the wood-volume field did not exist.
2. `c937e4e2` added tree-conditioned growth-coordinate sampling, multiscale ring/ray/fiber fields, material outputs, and bounded retention.
3. `cb612124` pinned exact material continuity across a trunk/branch attachment.
4. `93868311` pinned scale-demand filtering and deterministic field recreation.
5. `bc273425` stopped evaluating spatial nodes after footprint/detail filtering removes their scale.

## Executable evidence

Focused conditioned distribution → correlation → forest → geometry → growth-coordinate → volume chain:

```text
tests 29; pass 29; fail 0
```

Pinned first-tree observations:

```text
transverse/longitudinal shared points: exact same sample objects
active fine scales 3
trunk/branch attachment: path, ring, ray, fiber within 1e-6; base color exact
detail 0 active scales 1; detail 2 active scales 3
0.3-world-unit footprint active scales 0; ring 0.5; ray 0; fiber 0.5
recreated field: exact deterministic sample
```

The deterministic first-tree trunk sampled 1,024 unique points per pass over seven passes:

```text
cold three-scale median 28.3792 ms
retained three-scale median 4.0912 ms
retained speedup 6.9366x
fully filtered median 4.9214 ms
fully filtered speedup versus cold fine 5.7665x
checksum 27239.21960306816
```

This is private CPU field evidence. It does not claim measured wood realism, a rendered cut, GPU parity, or input-to-present performance.

Hidden WebGPU regression capture used the existing headless Edge helper and unchanged MAT030B oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9469 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or runtime failure.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, exactly preserving the established image oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-volume-field.mjs` | `89dac3e4dda8d407c3adbe0a7562e1102cf9b744` | `21B15CE6A4464ABC7B91D4C724C7D61E1DDFF81DCB991638429A512CF84674F1` |
| `tests/js/vf-wood-volume-field.test.mjs` | `72f2aefeeb6e2ae21b0ffb37eb34a3abffe0f4ac` | `7013E41EC1E72EBCDF4A65F599B948F9D50141AA79DE9867207D90A9F4F2C98E` |

## Remaining boundary

MAT050I proves one-volume coherence but does not yet create cut geometry or render a cut. Research/fitting must replace the provisional coefficients with one measured species and add earlywood/latewood, rays, vessels/pores, fibers, knots, branch collars, uncertainty, and goodness-of-fit receipts. A safe next private packet can generate two bounded cut-plane sample grids from the same volume and pack image-comparable material channels without touching the shared renderer.

Recovery: drop commits after base `a8f16bc6`; no 0.4 or shared renderer path was touched.
