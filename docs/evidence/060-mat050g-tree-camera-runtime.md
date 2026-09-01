# MAT050G tree camera runtime evidence

Date: 2026-09-01

## Packet

- Base: `c5cf7543` (MAT050F).
- Branch: `codex/0.6/060-mat050g-tree-camera-runtime`.
- Scope: private latest-revision camera controller joining MAT050C demand to MAT050B geometry, MAT050D materials, MAT050E packets, and the MAT050F bounded runtime.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-tree-camera-demand-runtime.mjs`, `tests/js/vf-tree-camera-demand-runtime.test.mjs`, and this receipt.

## Internal contract

- Camera requests carry monotonically increasing internal revisions. Multiple requests awaiting the same scheduled job collapse to the latest revision before any tree demand, geometry, material, packet, or runtime work occurs.
- Superseded requests resolve explicitly; stale committed or pending revisions do no work and schedule no job.
- The applied path selects bounded view demand, realizes only its planned primitives and aligned materials, forms retained per-tree packets, then transactionally applies the packet delta.
- Packet state commits only after the bounded runtime accepts its delta. A failed runtime application cannot advance controller packet state ahead of active memory.
- Moving beyond the camera far bound removes every active packet and releases runtime bytes. Returning to the same view regenerates identical packet content and topology/material identities.
- The default scheduler yields via `setTimeout`; callers may inject an internal scheduler for deterministic host integration.
- These are private reference mechanics. No camera, cache, renderer, material, or VKF event API is selected publicly.

## RED to GREEN

1. `7f5deea9` pinned two camera revisions collapsing into one 24-tree/256-primitive realization; it failed because the controller module did not exist.
2. `493b26cb` added latest-revision scheduling and the complete demand-to-runtime pipeline.
3. `297a2947` pinned far-view release, deterministic return, and stale-revision rejection.

## Executable evidence

Focused forest → camera demand → geometry → material → packet → runtime chain:

```text
tests 20; pass 20; fail 0
```

Pinned lifecycle:

```text
two pending revisions: scheduled jobs 1; procedural realizations 1
near view: trees 24; primitives 256; active bytes 18,176
far view: trees 0; primitives 0; active bytes 0
same near view returns: exact packet content; upload bytes 18,176
stale revision: scheduled jobs 0
```

The deterministic 24-tree / 256-primitive workload compared sixteen sequential camera applications with a sixteen-revision coalesced burst over seven fresh-controller passes:

```text
revisions per pass 16; realizations saved per burst 15
sequential median 56.6002 ms
coalesced median 23.8079 ms
coalesced speedup 2.3774x
checksum 2162944
```

This isolates CPU demand-to-runtime controller work; it is not a final input-to-present or WebGPU frame-throughput claim.

Hidden WebGPU regression capture used the existing headless Edge helper and unchanged MAT030B oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9467 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or runtime failure.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, exactly preserving the established image oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-tree-camera-demand-runtime.mjs` | `39659ca1589109ab38c30450b429921a4273f6a3` | `A2CAEA80E244796168321357309420717CA52B95AC95E6843C7A99CB5C1C3DE5` |
| `tests/js/vf-tree-camera-demand-runtime.test.mjs` | `3df330e5a55327b21781c298349a91714eadd78a` | `B10EA7495B06B43246831E655F3CC098FB341BD553EE1553786FC51F6B163BDC` |

## Remaining boundary

MAT050G stops at private CPU packets and runtime callbacks. It does not bind trees to shared WebGPU buffers, prove tree input-to-present latency, render leaf translucency/shadows/picks, deliver a measured species, or generate coherent wood cuts. A private non-renderer next packet can plan coherent trunk/branch growth coordinates for later wood cuts while 0.4 retains shared-renderer ownership.

Recovery: drop commits after base `c5cf7543`; no 0.4 or shared renderer path was touched.
