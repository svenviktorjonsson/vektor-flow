# MAT050H wood growth-coordinate evidence

Date: 2026-09-01

## Packet

- Base: `7212cedb` (MAT050G).
- Branch: `codex/0.6/060-mat050h-wood-growth-coordinates`.
- Scope: private, bounded solid-coordinate frames for demanded trunks and branches, as a prerequisite for coherent procedural wood cuts.
- Public VKF syntax/API/schema/ABI changes: none.
- Shared renderer changes: none.
- Owned paths: `web/vf-ui/vf-wood-growth-coordinates.mjs`, `tests/js/vf-wood-growth-coordinates.test.mjs`, and this receipt.

## Internal contract

- Only wood-bearing MAT050B primitives are realized: one trunk and four branches per full-detail tree. Crown and foliage records allocate no wood-coordinate data.
- Each segment carries a world-space origin, normalized growth axis, orthonormal radial frame, root-relative path offset, length, radius, source index, and local wood-parent index.
- A trunk origin is its base rather than the MAT050B cylinder center. Every branch begins at its geometry attachment point.
- A branch path offset equals the parent path offset plus its projected attachment distance along the parent axis. The trunk coordinate and child coordinate therefore agree exactly at their shared attachment in the pinned hierarchy.
- Child radial frames project the parent frame onto the child's normal plane, retaining stable correspondence without a flat per-surface texture orientation.
- Coarse-to-fine demand retains exact immutable trunk-coordinate records. Recreating the field produces identical vectors; traversal adds no random state.
- Output is GPU-friendly typed data costing exactly 68 vector bytes per wood segment. Realization is capped at 65,536 segments; zero budget creates no segment records or vectors.
- Segment memoization uses weak primitive keys, so the coordinate field does not extend MAT050B planner-cache lifetimes.
- These are internal reference coordinates, not a selected public wood type, ring model, cut operation, or material API.

## RED to GREEN

1. `dd238052` pinned a full tree's trunk/branch attachment continuity and orthonormal frames; it failed because the coordinate field did not exist.
2. `be54c9c6` added bounded lazy coordinate realization and weak identity retention.
3. `f284bb9a` pinned coarse-to-fine identity, deterministic recreation, zero demand, truncation, and the hard cap.

## Executable evidence

Focused forest → tree geometry → wood-coordinate chain:

```text
tests 8; pass 8; fail 0
```

Pinned full-detail tree:

```text
wood segments 5: trunk + 4 branches
source primitive indices [0, 2, 3, 4, 5]
local parents [-1, 0, 0, 0, 0]
vector bytes 340
all axes/radial frames unit and mutually orthogonal within 1e-6
all branch attachment path offsets continuous within 1e-5
```

The deterministic 64-tree / 1,408-primitive plan ran 256 coordinate realizations per pass over seven passes:

```text
wood segments 320; vector bytes 21,760
cold median 2.6176285156 ms/realization
retained median 0.9044058594 ms/realization
retained speedup 2.8943x
checksum 77987840
```

This measures private CPU coordinate realization only. It does not claim final wood shading, cut rendering, or input-to-present performance.

Hidden WebGPU regression capture used the existing headless Edge helper and unchanged MAT030B oracle:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-material-field-smoke.html <transient.png> 0 9468 rock_material_field_frame
```

- WebGPU initialized off-screen at 1,236 x 725 with no initialization or runtime failure.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77,754.
- Retained rock material buffers remained 144, 96, and 96 bytes.
- The transient 58,298-byte PNG had SHA-256 `20C7B5A2E8B1BA73F2CA56AEB5B22159F3D5F1AA8D07B3AAA5066A5DEC8F0B7A`, exactly preserving the established image oracle, and was removed.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-wood-growth-coordinates.mjs` | `5f8cb808b74fd19d0ecba77c2ccf7c764718330e` | `88336ED35CFC954574982EE791B80CE28030B9BF4F2CB2499DBA68696975EC6F` |
| `tests/js/vf-wood-growth-coordinates.test.mjs` | `ff22b5a256c29a737137f8e2f5bb43efe1a127c2` | `34227E4D9B41728091F82A2814447E7AC55E7DFBF7F477D62CFEAB965FE9E664` |

## Remaining boundary

MAT050H establishes skeletal solid coordinates only. It does not yet model annual rings, earlywood/latewood, rays, vessels, fibers, knots, branch collars, or a cut surface. The next isolated non-renderer packet can evaluate a deterministic multiscale wood-volume field in these coordinates and prove that two differently oriented cuts sample the same underlying volume.

Recovery: drop commits after base `7212cedb`; no 0.4 or shared renderer path was touched.
