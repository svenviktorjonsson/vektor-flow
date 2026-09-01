# MAT050K wood cut-surface packet evidence

Date: 2026-09-01

## Packet

- Base: `091be52a` (MAT050J).
- Branch: `codex/0.6/060-mat050k-wood-cut-surfaces`.
- Scope: private image-stable end-grain and side-grain packets from coherent MAT050J cut grids.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-wood-cut-surface-packet.mjs`, `tests/js/vf-wood-cut-surface-packet.test.mjs`, and this receipt.

## Internal contract

- `end-grain` and `side-grain` identify private cut orientation; no public material constructor or enum is introduced.
- Each packet retains its MAT050J grid and directly reuses position, growth-coordinate, base-color, and material-channel vectors. It does not duplicate the 60-byte-per-sample source vectors.
- Row-major linear RGBA values are deterministically clamped and quantized to an image-stable RGBA8 plane. This is a reference visualization, not a color-managed final renderer claim.
- A regular triangle-list index vector covers the cut plane with deterministic winding. The packet normal is the cross product of the grid's normalized axes.
- Packet identity includes primitive, orientation, and grid shape. An unchanged grid/orientation returns the exact same packet object, image buffer, and index buffer; the other orientation has a distinct packet.
- MAT050J's sample cap remains authoritative. This adapter allocates only RGBA8 plus triangle indices on first realization and retains them with the source grid through a weak cache.

## RED to GREEN

1. `f7eb254c` required coherent end/side cut pixels; it failed because no cut-surface adapter existed.
2. `41a00a71` added deterministic orientation packets and RGBA8 reference images.
3. `bbd3a537` required triangle topology without source-vector copies; `e9d02b68` added shared vectors, topology, and normals.
4. `0244a91d` required exact packet retention; `0ed9b312` added per-grid/orientation weak retention.
5. `aca6befd` pinned the deterministic 5 x 5 end/side image hashes.

## Executable evidence

Focused conditioned distribution → correlation → forest → geometry → growth-coordinate → volume → cut-grid → cut-surface chain:

```text
tests 35; pass 35; fail 0
```

Pinned 5 x 5 RGBA8 image hashes:

```text
end-grain SHA-256  42FB44A549BF93745A4044F1ADD5ED5B4C12EF3DAD0C6A89571B1AC0F5248820
side-grain SHA-256 793F6F5ADA3FAFFAFF37A0D27E0F2A23DC9694B39CD5184C34DED0E31A9A2EF9
shared intersection pixels: 5/5 exact
```

A 64 x 64 packet contains 4,096 pixels, 7,938 triangles, and 111,640 newly allocated bytes (16,384 RGBA bytes plus 95,256 index bytes). Its 245,760-byte source vectors remain shared.

```text
64 x 64 end-grain RGBA SHA-256  8314BD492941736A61E1335F5C9E696281D5D83B3CFCAC86A81620FC9BF7D991
64 x 64 side-grain RGBA SHA-256 A81D56D69574E218B1EFB68C1B777A81F51EC010D467148107BCEDFD46EA284E
20 cold packet realizations mean 1.168210 ms; stddev 0.494201 ms; range 0.737200–3.074700 ms
10,000 retained lookups mean 0.000521 ms; stddev 0.001783 ms; range 0.000200–0.088100 ms
```

The retained timing is below coarse wall-clock resolution and is evidence of exact object reuse/zero new packet vectors, not a trustworthy multiplicative speedup claim.

Hidden WebGPU regression capture used the existing headless Edge helper and unchanged MAT030B oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9471 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or runtime failure.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, exactly preserving the established image oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-cut-surface-packet.mjs` | `1068bd06e3c8e9afd303526cfd4f89aeb57a6d9c` | `9E2177A8B67D99C8644EE8DB437D198D069142B6A2FAA4152F2FE18AE77BB083` |
| `tests/js/vf-wood-cut-surface-packet.test.mjs` | `aacbf897a9f76e72eaf509269edd301640d19c14` | `655CD7BF1643A74A6CFA3D9DDAD86B8FF13AC68DD9F87A663BDEA4D3E13D3002` |

## Remaining boundary

MAT050K proves deterministic cut previews and surface topology but does not submit those packets to WebGPU, model physical anisotropy, or claim measured wood realism. A safe next private packet can derive orientation-aware normal/roughness reference channels from the same coherent volume while keeping the public material and renderer contracts undecided.

Recovery: drop commits after base `091be52a`; no 0.4 or shared renderer path was touched.
