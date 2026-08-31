# MAT030F instanced GPU grass evidence

Date: 2026-08-31

## Packet

- Base: `569b6d25adcefab4c7a31bc6176d7e5083311962`
- Branch: `codex/0.6/060-mat030f-grass-gpu-instances`
- Scope: deterministic 64-byte grass blade instance records, dedicated WebGPU vertex expansion, and MAT030E runtime routing.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-grass-material-field.mjs`
  - `web/vf-ui/vf-grass-camera-demand-runtime.mjs`
  - `web/vf-ui/geom/vf-geom-wgpu.js`
  - `tests/js/vf-grass-material-instances.test.mjs`
  - `tests/js/vf-grass-camera-demand-runtime.test.mjs`
  - `tests/js/vf-geom-grass-blade-instances.test.mjs`
  - `docs/evidence/060-mat030f-grass-gpu-instances.md`

## Observable contract

- Every blade is represented by sixteen f32 values: origin and height; planar direction, half-width, and roughness; lean and padding; RGBA color. The record is exactly 64 bytes.
- Every retained cell keeps its existing `grass:cell:x:y` identity. It now carries one four-vertex/six-index blade template plus `grass-blade-list` instances rather than expanding four vertices and six indices for every blade on the CPU.
- The dedicated `vs_grass_blade_instance` WGSL entry expands base width, tapered tip, height, and lean per vertex and forwards the deterministic per-blade color through the existing fragment path.
- Instance records reconstruct the prior CPU quad positions and colors within f32 tolerance. Recreating the field yields identical records; raising detail appends records without changing the established byte prefix.
- Upload remains bounded by `184 * cellPacketCount + 64 * bladeCount`, while MAT030E retains the 4,096-cell, 65,536-blade, and 65,536-scanned-cell limits.
- One 16-blade cell uploads 1,208 bytes instead of 2,944 expanded bytes, a 58.97% reduction. The low-detail horizon capture uploads 39,936 bytes instead of 47,104, because each of its 128 cells contains only two blades.
- MAT030E coalescing, steady-view zero upload, stable shared packet objects, far clipping, and deterministic eviction remain unchanged. Runtime packets now select the dedicated GPU pipeline automatically.

## RED to GREEN

1. The instance tests failed because `createGrassRendererInstancePacketsReference` did not exist. `11c27b4` factored the pinned blade sampler and added byte-stable 64-byte records plus one immutable blade template per retained cell.
2. The renderer contract failed because no `GrassBladeInstVin`, 64-byte layout, WGSL entry point, or pipeline existed. `d0de95f` added the dedicated vertex expansion and `grass-blade-list` pipeline selection.
3. The runtime test still observed expanded packets. `808c96f` routed MAT030E demand through the instanced packet factory and included instance bytes in bounded upload receipts.

## Executable evidence

Affected material/runtime/renderer chain:

```text
node --test tests/js/vf-grass-material-instances.test.mjs tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-geom-grass-blade-instances.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 40; pass 40; fail 0
```

Real renderer capture, launched only through the existing Edge `--headless=new` helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-camera-demand-runtime-smoke.html tests/fixtures/grass-camera-demand-runtime-smoke.png 0 9404 grass_camera_demand_runtime_frame
```

Observed committed-fixture capture evidence:

- WebGPU compiled the dedicated shader and initialized off-screen at 1,236 x 725 with no initialization, compilation, validation, provider, or runtime failures.
- Frame sequence and adapter revision reached `2`; the renderer retained one ground packet plus 128 `grass-blade-list` packets.
- Every grass packet used one 40-value/four-vertex template, six indices, and two instances, matching the 256-blade deterministic runtime receipt.
- Renderer evidence remained truly zero-light: zero active/planned lights and zero assignments.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 35,118.
- The transient 26,322-byte PNG had SHA-256 `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7`, was visually checked, and was removed. Its bytes exactly match the MAT030E expanded-quad capture, providing end-to-end pixel equivalence for the pinned scene.

Repository suite:

```text
npm test
tests 486; pass 483; fail 3
```

The same three inherited integration failures remain outside owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-field.mjs` | `0b0eddf56061145b7a87eef664240d3ef36cc877` | `D9B511B62A1C1592CEEF0D325977CDF7AA1A24D5A4F3D66829E4FC2AA77E1AA3` |
| `web/vf-ui/vf-grass-camera-demand-runtime.mjs` | `1b36bc57d14bae7fd3aac06c3f4fc48e29293f7c` | `724E0ACE55390DC8A6ED67B1053DDFBFED9815FE5FE8DBB4870D8D5AA4FF0E60` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `8bfaffd51131a5f0483d803fe7716d5a36039d2b` | `2ADFD7DD0684341D871410C96E5361DC939CE6F05EE4177A60792D4AA5274EBD` |
| `tests/js/vf-grass-material-instances.test.mjs` | `fbb366a7478fb64a42216524629ae278bc079bce` | `87B410251F6BB895B43CE1F30973325E6E97A3F639EF7C5F1B98CE404D004B20` |
| `tests/js/vf-grass-camera-demand-runtime.test.mjs` | `d2b31660453ecfe326320d091485f523dd8a0fb1` | `2B4D94BF5B575A6A1BCC57956ECD3BA057B2C5C0D6E6A352DDB88682D9E9DE9E` |
| `tests/js/vf-geom-grass-blade-instances.test.mjs` | `e68033f3f008d536f627ec4ab17098b6f0582802` | `2350F4C5A44A05D054BDCA972AE60C70AF7F7B17673E0DC074FF96DB97204FAE` |
| `tests/fixtures/grass-camera-demand-runtime-smoke.html` | `56b886bde02bf7e30e541064b5dcc959ace572f4` | `4CD80C5058FCE601FA47FC9FC52D01D11E564E1FB12C611865AE6ADAE95C363F` |

## Remaining boundary

Blade traits are still sampled on the CPU before upload, and each retained cell currently owns a separate copy of the tiny immutable template GPU buffers. A later internal packet can share that template across cells or batch compatible cells, then move Philox/conditioned trait generation into WGSL while retaining the same demand keys and record oracle. Instanced grass is intentionally unlit and non-pickable in this packet, so a future material packet must add an instanced shadow/pick path before grass participates in those passes.

Recovery: drop commits after base `569b6d2`; no other worktree is required.
