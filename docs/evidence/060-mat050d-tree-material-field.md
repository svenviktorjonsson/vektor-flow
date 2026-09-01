# MAT050D lazy tree material evidence

Date: 2026-09-01

## Packet

- Base: `fec0625` (MAT050C).
- Branch: `codex/0.6/060-mat050d-tree-material-field`.
- Scope: internal deterministic species, individual-tree, and primitive-surface bark/foliage realization over bounded tree geometry.
- Public VKF syntax/API/schema/ABI changes: none.
- Renderer changes: none.
- Owned paths: `web/vf-ui/vf-tree-material-field.mjs`, `tests/js/vf-tree-material-field.test.mjs`, and this receipt.

## Internal contract

- Material identities derive from the stable conditioned forest → species → individual tree → primitive hierarchy. Traversal and unrelated refinement do not enter random state.
- Trunks and branches receive bark descriptors; crowns and foliage clusters receive foliage descriptors.
- Species-level traits set base bark/foliage color, roughness, and procedural pattern scale. Individual trees add smaller color/roughness variation; individual primitives add still smaller surface variation.
- Output is GPU-friendly packed data aligned with MAT050B primitive IDs: `Uint8Array` material kinds plus `Float32Array` RGBA colors and four surface parameters (roughness, normal strength, subsurface response, pattern scale).
- Each realized material costs exactly 33 vector bytes. A material budget of zero realizes no tree or primitive state; all work is capped at 65,536 materials.
- Repeated refinement reuses exact immutable material records. Tree state has a 4,096-tree least-recently-used cap; WeakMap ownership releases the complete cache with its field.
- These are internal reference descriptors, not frozen public material names or schema.

## RED to GREEN

1. `bf96ce8` pinned lazy packed bark/foliage behavior and failed because the material field did not exist.
2. `88a2582` added bounded conditioned material realization and retained tree/primitive caching.
3. `bbb2356` pinned exact material vectors, coarse-to-fine object identity, and same-species individual variation.

## Executable evidence

Focused affected chain:

```text
tests 41; pass 41; fail 0
```

Pinned full-detail first tree:

```text
materials 22; vector bytes 726
kinds: bark trunk, foliage crown, 4 bark branches, 16 foliage clusters
trunk RGBA [0.2267715484, 0.1599140167, 0.0800482258, 1]
trunk surface [0.7590516806, 0.5253937244, 0, 5.3558716774]
crown RGBA [0.1810378432, 0.2869136035, 0.0856078789, 1]
crown surface [0.5821430087, 0.3674385250, 0.1302517653, 2.1605498791]
```

Node timing used the MAT050C 24-tree / 256-primitive view set, 128 realizations per pass, and seven passes. Every cold and retained result reproduced the exact checksum:

```text
material records 256; vector bytes 8,448
cold median 3105.5563 ms; retained median 79.6587 ms
retained hierarchy speedup 38.9858x
checksum 256:8448:tree:v1:candidate:v1:f77d43b5:7b936503:dc2bc437:a9d24d29:trunk:tree:v1:candidate:v1:58373f6d:9214c7ac:0f9a5d83:32edb1b2:branch:3:foliage:3:0.14699937403202057:1.9152275323867798
```

Headless WebGPU regression evidence:

```text
CPU/GPU parity pass; records 3; maxAbsoluteError 0.00024956464767456055
hidden PNG 58,298 bytes
SHA-256 20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A
```

The capture is exactly unchanged from MAT030B through MAT050C. WebGPU initialized at 1,236 x 725 without initialization/runtime failures; retained rock buffers stayed 144, 96, and 96 bytes.

Repository suite:

```text
npm test
tests 525; pass 522; fail 3
```

The same inherited failures remain outside this packet: stale generated HTML component catalog, symbolic document scope `-8` versus `8`, and named symbolic geometry `[-5, -624]` versus `[-5, 625]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-tree-material-field.mjs` | `88f5d6d1f333706e69972d18b0e56ef7d9671279` | `DFB6BB6F0D3F6DF679362CA67F36E174F2FE1F4F9C6DD4566395674E66055C38` |
| `tests/js/vf-tree-material-field.test.mjs` | `712cae79f21a671052fad44abaf3d1ff841b4a5a` | `95DB0D0DF20FF4410181A46049E53707D173B80F6B3FD44E07F58E3BC15FA529` |

## Remaining boundary

This packet materializes internal descriptors only. Renderer binding, leaf translucency/shadow realization, botanical presets, temporal material refinement, and a public material API remain uncommitted. A safe next packet can coalesce these aligned geometry/material vectors into retained internal tree packets without touching the shared renderer.

Recovery: drop commits after base `fec0625`; no 0.4 or shared renderer path was touched.
