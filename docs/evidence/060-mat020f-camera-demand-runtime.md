# MAT020F camera-demand runtime evidence

Date: 2026-08-31

## Packet

- Base: `918855b9e6f53fd5e98a46d645f0851ddddd7185`
- Branch: `codex/0.6/060-mat020f-camera-demand-runtime`
- Scope: internal camera-demand controller, retained geometry packet runtime, and stable-object renderer retention for MAT020 rock detail.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-rock-camera-demand-runtime.mjs`
  - `web/vf-ui/geom/vf-geom-wgpu.js`
  - `tests/js/vf-rock-camera-demand-runtime.test.mjs`
  - `tests/js/vf-geom-retained-part-identity.test.cjs`
  - `tests/fixtures/rock-camera-demand-runtime-smoke.html`
  - `docs/evidence/060-mat020f-camera-demand-runtime.md`

## Observable contract

- `request({ revision, camera })` returns immediately and schedules bounded demand/refinement/packet work on a later task by default.
- Several camera revisions queued in one event turn coalesce to the highest revision. Superseded callers receive an explicit receipt and no superseded demand reaches retained packets.
- Revisions at or below the committed or pending revision are explicitly reported as stale.
- The controller selects camera demand, updates the bounded working set, adapts only its changed packet delta, and applies `delta.remove`/`delta.upsert` directly to a retained packet map.
- Steady demand has zero upload bytes and does not request another renderer update.
- A one-face camera change uploads exactly one 4-vertex/3-face detail packet: 40 float values plus 9 indices, 196 bytes total.
- Evicted detail regenerates exactly from its stable face identity. Coarse and retained detail packet objects remain unchanged.
- The existing WebGPU renderer now matches reusable scene parts by stable `object_id`, not array position. A retained detail that shifts slots keeps its GPU buffers; only the evicted part is destroyed and the new part is created.

## RED to GREEN

1. The first controller/coalescing test failed because `vf-rock-camera-demand-runtime.mjs` did not exist. `7c53070` added the minimal scheduled controller and retained packet runtime, returning the test to green.
2. `5c05a91` pinned stale-revision, upload-free steady-state, 196-byte changed-detail, and exact regeneration behavior.
3. The renderer-retention test failed because `_uploadSceneParts` matched the new scene by array index, recreating a stable detail after reorder. `42ebcd1` changed matching to stable object identity and returned renderer plus affected lighting evidence to green.
4. `721c4f7` added an off-screen runtime fixture and strengthened the camera transition to force a retained detail to change array position.
5. `58613ca` pinned that the default scheduler yields to the event loop before any renderer work.

## Executable evidence

Affected geometry/runtime chain:

```text
node --test tests/js/vf-demand-refined-geometry.test.mjs tests/js/vf-ellipsoid-view-demand.test.mjs tests/js/vf-refinement-working-set.test.mjs tests/js/vf-rock-renderer-packets.test.mjs tests/js/vf-rock-camera-demand-runtime.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 37; pass 37; fail 0
```

Real GPU capture, launched only through the existing Edge `--headless=new` helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/rock-camera-demand-runtime-smoke.html tests/fixtures/rock-camera-demand-runtime-smoke.png 0 9365 rock_camera_demand_runtime_frame
```

The fixture applied camera revisions 1, 2, and 3. Revision 2 evicted one detail while the survivor moved renderer slots; revision 3 regenerated the original detail. Observed capture evidence:

- WebGPU initialized at 1236 x 725 with no initialization or runtime failures.
- Dynamic adapter revision and rendered frame sequence both reached `4`, proving updates after initial mount.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 77678.
- The final live provider and renderer contained exactly three parts: the unchanged coarse packet and two regenerated/retained detail packets with 60/24, 40/9, and 40/9 vertex-value/index counts.
- The transient 58,240-byte PNG had SHA-256 `63043FB27C8C8BE3D422E4C52F3C6F966F1958E7E9E0B36388DE87932319DCD4` and was visually checked for the closed lit rock silhouette, then removed. No generated binary remains.

Repository suite:

```text
npm test
tests 455; pass 452; fail 3
```

The same three base/integration failures remain outside owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-rock-camera-demand-runtime.mjs` | `afcf4dd05deb1c94d62156ef9749f87fe6b2331a` | `A4DFABEA78AE6CADD3110130B9FB32031CB71A3EB57315093D684940A110218B` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `264a8e08970233d96597c2a7bf7f8be4eb215586` | `9D6C1811DD493549D5E325932FEA676D8DC3DFBAE00E7269E3D3DC82EBB53D65` |
| `tests/js/vf-rock-camera-demand-runtime.test.mjs` | `41c55980f26e7b9a50517d3d5fddc75496716dfa` | `7B7B697FDC1AF9FF430DDC84883125CA30E39FCCF14B335DA08D17476136071F` |
| `tests/js/vf-geom-retained-part-identity.test.cjs` | `5464c07ba7337dedc7ca03174cf64ab5addbab81` | `7228250A63E311629B146451039B01C8F49F7D69972CF8C5EAEF994867F175ED` |
| `tests/fixtures/rock-camera-demand-runtime-smoke.html` | `69c5fa4e4da77f941731c9382f6d8dd7c30c8db7` | `4AF93211A4345DE216FE15FD28ADC7E333030BF2CAF012B8E13283457B11B216` |

## Remaining boundary

Demand calculation is intentionally small and bounded to the current eight coarse faces, so it runs in the scheduled main-thread task after yielding. A revision that arrives before that task begins supersedes it; an already-running bounded task is not interrupted mid-function. The controller remains internal and is not exposed through VKF syntax or a public renderer API.

Recovery: drop commits after base `918855b` on this packet branch; no other worktree is required.
