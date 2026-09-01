# MAT050J bounded wood cut-grid evidence

Date: 2026-09-01

## Packet

- Base: `b4180cc6` (MAT050I).
- Branch: `codex/0.6/060-mat050j-wood-cut-grids`.
- Scope: private bounded transverse/longitudinal cut-plane grids packed from one coherent cached wood volume.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-wood-cut-plane-grid.mjs`, `tests/js/vf-wood-cut-plane-grid.test.mjs`, and this receipt.

## Internal contract

- A cut request supplies a segment, center, two plane axes, extents, row/column shape, material demand, and a hard sample budget.
- Axes are normalized and orthogonalized before sampling. Packed metadata preserves that plane transform so a later private renderer can reconstruct texel positions without resampling.
- Row-major vectors contain world position, coherent growth coordinates, RGBA base color, and five material channels: ring, ray, fiber, density, and roughness. The exact immutable MAT050I sample objects are also retained.
- A transverse plane and longitudinal plane with the same center/U axis reuse exact cached sample objects along their intersection. They do not create separate two-dimensional procedural textures.
- Sample count must fit both the caller budget and the private 65,536-sample cap before allocation or field access. Oversized requests fail atomically rather than partially realizing a plane.
- This is an internal reference packet. It does not freeze a public cut API, material schema, renderer upload ABI, or species model.

## RED to GREEN

1. `a5b25290` required two oriented packed grids to share cached volume samples at their intersection; it failed because no cut-grid adapter existed.
2. `4f3fac6f` added bounded row-major sampling and typed material vectors.
3. `1ff53c81` required normalized plane metadata; `55c88e67` retained it.
4. `171e52a2` required explicit bounds and pre-sampling rejection; `ebddcba0` exposed the satisfied hard budget.

## Executable evidence

Focused conditioned distribution → correlation → forest → geometry → growth-coordinate → volume → cut-grid chain:

```text
tests 32; pass 32; fail 0
```

Pinned observations:

```text
transverse/longitudinal shared middle row: 5/5 exact same sample objects
5 x 5 packed grid: 25 samples; 1,500 typed-vector bytes
64 x 64 maximum retained-volume probe: 4,096 samples; 245,760 typed-vector bytes
65,537-sample request: rejected before field sampling
```

Ten local 64 x 64 runs measured packing from fresh versus already-populated MAT050I fields:

```text
fresh field mean 113.465970 ms; stddev 39.039627 ms; range 80.985100–223.139200 ms
retained field mean 26.785070 ms; stddev 4.908602 ms; range 16.106500–34.363500 ms
retained speedup 4.236165x
```

This measures the private CPU reference adapter, including new typed-vector allocation each run. It is not GPU upload, rendered-cut, or end-to-end frame evidence.

Hidden WebGPU regression capture used the existing headless Edge helper and unchanged MAT030B oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9470 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or runtime failure.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, exactly preserving the established image oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-cut-plane-grid.mjs` | `a0ff4b72ac15152e106a1b298797b1b8902f8cd2` | `3CD5748C02C1F885D91B5D86E73650C59111E88F9A8C47168A0D70ADC238E20E` |
| `tests/js/vf-wood-cut-plane-grid.test.mjs` | `3757a393ff00e706760c030701bd73b544413366` | `42EB4226BCDE989DA346BEE1E24D26AC4465A3AB509ECBECCA67EB1AA696B912` |

## Remaining boundary

MAT050J proves bounded, coherent cut sampling and CPU packing but does not generate cut mesh topology or render the packed channels. The next safe private packet can derive image-stable transverse/end-grain and longitudinal/side-grain surface packets from these vectors, while leaving renderer integration and public material choices to later approved work.

Recovery: drop commits after base `b4180cc6`; no 0.4 or shared renderer path was touched.
