# MAT050L wood cut material-channel evidence

Date: 2026-09-01

## Packet

- Base: `8f81b204` (MAT050K).
- Branch: `codex/0.6/060-mat050l-wood-cut-material`.
- Scope: private image-stable tangent-normal and roughness planes derived from
  coherent MAT050K end-grain and side-grain packets.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-wood-cut-material-packet.mjs`,
  `tests/js/vf-wood-cut-material-packet.test.mjs`, and this receipt.

## Internal contract

- MAT050L consumes an existing retained MAT050K surface packet and keeps its
  positions, growth coordinates, base colors, and five material channels by
  exact reference. It allocates no replacement source vectors.
- A single coherent scalar material-height reference combines ring, ray,
  fiber, and density channels. Resolution-normalized finite differences along
  each cut plane produce a deterministic tangent-space normal plane.
- Roughness is quantized directly from the coherent volume sample. The shared
  end/side intersection therefore preserves the same roughness samples while
  its two plane orientations produce distinct normal fields.
- One packet allocates only four normal bytes plus one roughness byte per
  demanded sample. An exact weak-key cache retains the packet for an unchanged
  surface and does not retain evicted source surfaces.
- The fixed material-height weights and normal strength are private reference
  policy, not a public wood-material model or author control.

## RED to GREEN

1. `ea99924e` required bounded normal and roughness planes from coherent cut
   grids. The focused test failed with `ERR_MODULE_NOT_FOUND` because no wood
   cut material adapter existed.
2. `b8c0aeed` added the private finite-difference adapter, exact vector reuse,
   and weak-key packet retention. The focused test passed.
3. The deterministic-image test first failed against pending oracle labels and
   exposed all four actual hashes. `010048d0` pins those accepted bytes and the
   exact retained-object behavior.

## Executable evidence

Focused MAT010 conditioned/correlation through MAT050L forest, geometry,
growth-coordinate, wood-volume, cut-grid, cut-surface, and cut-material chain:

```text
tests 38; pass 38; fail 0; duration 1,163 ms
```

Pinned 5 x 5 channel hashes:

```text
end-grain normal     3509090CE388ECD8562F62586B6EC0154150BE71BA1561B9DACBA8A37247F2E3
end-grain roughness  F65A8E2E06DC27F9E0DB270EFF88370D07AF0C4477129C44053A385B2A1E4E58
side-grain normal    84E44E512EA80E1E52EF126629FDC7FD98D18A50593CC45D9248436F1AEE6F66
side-grain roughness CC802886530DCBE7A81D28FBA0BF531F32344A70640B8D33E780F509784E8CB8
shared intersection roughness samples: 5/5 exact
```

A 64 x 64 packet adds exactly 20,480 bytes for 4,096 samples. Seven timing
passes each created 100 fresh packets; seven retained passes each performed
10,000 exact-cache lookups:

```text
cold packet mean 1.287897 ms; stddev 0.094578 ms; range 1.069627-1.368779 ms
retained lookup mean 0.000099 ms; stddev 0.000026 ms; range 0.000078-0.000157 ms
```

The retained timing is below coarse wall-clock resolution and proves object
reuse and zero new vectors rather than a trustworthy multiplicative speedup.

Hidden WebGPU regression capture used the existing headless Edge helper and
unchanged MAT030B oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9483 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or
  runtime failures.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256
  `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`,
  exactly preserving the established oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-cut-material-packet.mjs` | `54931939a23298cdf98597fa0a413dcbf121f4e5` | `4F40218A328B141EB74309D8651CC2D60AE9434F96B01133A9AFE8569102DDF1` |
| `tests/js/vf-wood-cut-material-packet.test.mjs` | `812e8e2189ed16269b4afe5c90959d7439de7a17` | `E43190E62EC945E82CAD66F40CAD58A7DB03A80474E9519B8B4E5B57AB8D7397` |

## Remaining boundary

MAT050L proves coherent orientation-dependent reference channels but does not
submit them to WebGPU, model measured anisotropic wood BRDF response, or expose
wood controls. A safe next private packet can add filtered scale-aware normal
derivatives from the same wood volume or a renderer-independent material-energy
oracle before any shared renderer or public material decision.

Recovery: drop commits after base `8f81b204`; no 0.4 or shared renderer path was
touched.
