# MAT050E retained tree packet evidence

Date: 2026-09-01

## Packet

- Base: `fe3dc266` (MAT050D).
- Branch: `codex/0.6/060-mat050e-tree-render-packets`.
- Scope: internal retained per-tree batches that coalesce aligned MAT050B geometry and MAT050D material vectors.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-tree-renderer-packets.mjs`, `tests/js/vf-tree-renderer-packets.test.mjs`, and this receipt.

## Internal contract

- One immutable packet owns one demanded tree. Primitive IDs, geometry kinds, levels, local parents, transforms, material kinds, RGBA colors, and surface parameters stay aligned.
- Global planner parent indices are localized inside each tree batch. Owners are represented once by the packet tree identity instead of repeated in a four-byte vector entry.
- Packet order follows canonical tree demand order; primitive order follows MAT050B. No random state or traversal order is introduced.
- Exact primitive and material record identities retain the exact packet object. Refining one tree uploads only that tree; unchanged neighboring trees retain packet identity. Removing a tree emits its packet ID without uploading survivors.
- A full-detail tree contains 22 primitives and 1,562 packet-vector bytes, exactly 71 bytes per primitive. The existing upstream 65,536 primitive/material caps bound all copies.
- The adapter rejects incomplete or misaligned material working sets before building packets.
- Packet names and shapes remain internal reference data. This packet does not select a public material, scene, renderer, pick, or shadow API.

## RED to GREEN

1. `bbcbb074` pinned the aligned full-tree batch and zero steady upload; it failed because the adapter module did not exist.
2. `ddde57dc` added validation, per-tree packing, local parent remapping, retained identities, and delta/upload accounting.
3. `2a704eb2` pinned independent neighboring-tree retention across coarse-to-fine refinement and removal.

## Executable evidence

Focused affected chain:

```text
tests 16; pass 16; fail 0
```

Pinned full-detail first tree:

```text
packets 1; primitives 22; vector bytes 1,562
steady packets 0; steady primitives 0; steady upload bytes 0
```

The deterministic 24-tree / 256-primitive view set ran 256 adaptations per pass over seven passes. Each pass reused the same MAT050B and MAT050D identities:

```text
packets 24; primitives 256; cold upload bytes 18,176
cold median 0.4704453125 ms/adaptation
retained median 0.2209585938 ms/adaptation
retained speedup 2.1291x
steady upload bytes 0
checksum 32571392
```

This isolates CPU packet construction and upload volume; it is not a final renderer frame-throughput claim.

Hidden WebGPU regression capture used the existing headless Edge helper and the unchanged MAT030B rock oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9465 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or runtime failure.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, exactly preserving the established image oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-tree-renderer-packets.mjs` | `3be41abc36b2911e3a9b58b9d9061abab5ac8ded` | `1AC1F9BE58B0067DA0F894372CECB26EA90E75FE4F5371B39200E6B8628E3077` |
| `tests/js/vf-tree-renderer-packets.test.mjs` | `5724db547054c91cf08641b6aa49b75164a5ad79` | `52ECDDEDFC67A684CCC9920855808AF8DE5111478D672277C8B8521E83A0BB7A` |

## Remaining boundary

These packets are not yet consumed by the shared WebGPU renderer. Leaf translucency, tree shadows/picks, renderer buffer ownership, botanical presets, and public material selection remain uncommitted. A safe next isolated packet can add a bounded tree-packet runtime cache or a private renderer bridge after the 0.4 renderer lane is free.

Recovery: drop commits after base `fe3dc266`; no 0.4 or shared renderer path was touched.
