# MAT020E retained rock renderer packet evidence

Date: 2026-08-31

## Packet

- Base: `5d08cab06589b278a866ff81c62df0329b8d9180`
- Branch: `codex/0.6/060-mat020e-renderer-packets`
- Scope: internal adapter from the MAT020D ellipsoid refinement working set to the existing `field_mesh` retained WebGPU geometry packet shape.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-rock-renderer-packets.mjs`
  - `tests/js/vf-rock-renderer-packets.test.mjs`
  - `tests/fixtures/rock-renderer-packet-smoke.html`
  - `docs/evidence/060-mat020e-renderer-packets.md`

## Observable contract

- The immutable coarse octahedron is packet `rock:ellipsoid-octahedron:v1:coarse`, object id `1`, and is reused by identity for every later camera demand.
- Every demanded coarse face becomes one triangle-list detail packet. Its stable packet id is `rock:detail:<face-id>` and its object id is the stable coarse-face ordinal plus two.
- Stable vertex and face ids survive packing in `vertex_ids` and `face_ids`; renderer data is the existing 10-float position/normal/color layout plus `Uint32Array` indices.
- A retained face reuses its packet object. A changed face produces one upsert and one removal; steady demand produces no upsert or removal.
- Upload evidence is explicit and bounded. One level-one detail costs exactly 4 vertices, 3 faces, 40 vertex floats, 9 indices, and 196 bytes. Replacing two details costs exactly 392 bytes. The coarse packet is counted only during initial creation.
- Evicted details regenerate byte-for-byte and identity-for-identity from the same stable coarse face key.
- The adapter rejects malformed retained state and state belonging to another coarse shape.

## RED to GREEN

1. Initial packet identity/layout test failed before `adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference` existed; implementation and first test landed in `a9cf7c7`.
2. Changed-only and steady-state delta behavior was added in `e5184bb`; the implementation already satisfied the new oracle without widening the adapter.
3. Eviction/regeneration behavior was added in `48be6f0`; exact regenerated packets matched the original values while remaining new objects.
4. Malformed/cross-shape predecessor tests exposed missing ownership validation; fixed in `e57d320`.
5. Exact float32 positions, ellipsoid-gradient normals, colors, indices, and renderer flags were pinned in `828f94d`.
6. Exact upload-byte expectations produced 3 focused failures because `delta.upload.bytes` was absent. `f044451` added the bounded byte receipt and returned the focused suite to 5/5 green.
7. `31ecec1` added the off-screen WebGPU smoke fixture used by the real retained geometry renderer.

## Executable evidence

Focused geometry chain:

```text
node --test tests/js/vf-demand-refined-geometry.test.mjs tests/js/vf-ellipsoid-view-demand.test.mjs tests/js/vf-refinement-working-set.test.mjs tests/js/vf-rock-renderer-packets.test.mjs
tests 31; pass 31; fail 0
```

Real GPU image/capture oracle, always launched with Edge `--headless=new` by the existing helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-renderer-packet-smoke.html tests/fixtures/rock-renderer-packet-smoke.png 0 9364 rock_renderer_packet_frame
```

Observed evidence:

- WebGPU initialized at 1236 x 725 with no initialization or runtime failures.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 73014.
- The live provider scene and renderer both contained exactly three parts:
  - coarse: 60 vertex values, 24 indices;
  - detail `face:+x:+y:+z`: 40 vertex values, 9 indices;
  - detail `face:+x:+y:-z`: 40 vertex values, 9 indices.
- The transient 54,744-byte PNG had SHA-256 `6CB948673E0917B24429EA329B924A86BF522813611BEB8363003ADA0A517368` and was visually checked for the lit closed rock silhouette, then removed. No generated binary is retained in the worktree.

Repository suite:

```text
npm test
tests 450; pass 447; fail 3
```

The same three base/integration failures remain, outside this packet's owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-rock-renderer-packets.mjs` | `b058de4c7206bf0bff75fca9997685d8187eebd7` | `29AA8EC9DACCB8996858CC5B718EDF76739EA8F9B7281B3D6DBB063078167164` |
| `tests/js/vf-rock-renderer-packets.test.mjs` | `ab68c0fe2ec1ff474a7bf356f1fcad8818b40cd2` | `3C902BEA82415FC48D088D6964567BE863C20597ABFCEAE9254AEF4B93164334` |
| `tests/fixtures/rock-renderer-packet-smoke.html` | `af9323b7c9620881431744901e03d3c354df3ab3` | `47E8D757A6FDB590DC224BBCEF3D589FFDBB429E525BF225A093CD8708F23722` |

## Remaining boundary

This packet provides and proves the retained packet/delta seam and validates initial packet consumption by the real GPU renderer. It does not add a public rock/material API, a runtime camera-demand controller, or a renderer command that applies the delta directly. Runtime demand orchestration can consume `delta.upsert`/`delta.remove` in a later internal packet without changing the stable geometry identities established here.

Recovery: drop commits after base `5d08cab` on this packet branch; no other worktree is required.
