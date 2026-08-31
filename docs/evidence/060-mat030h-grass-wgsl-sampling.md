# MAT030H WGSL grass sampling evidence

Date: 2026-08-31

## Packet

- Base: `5e378a2a6a728bf69c4706b46090f62ec4ad8c81`
- Branch: `codex/0.6/060-mat030h-grass-wgsl-sampling`
- Scope: replace CPU per-blade sampling/upload with bounded per-cell conditioned stream descriptors and a WebGPU compute pass.
- Public VKF syntax/API/schema changes: none. All descriptors and adapters are internal renderer reference contracts.

## Observable contract

- Each active cell uploads one deterministic 48-byte record: signed cell coordinates, the pinned two-word Philox key and counter prefix, filtered blade height/roughness, and RGBA base color.
- One 16-byte compute parameter record supplies the bounded instance count, blades per cell, and cell count. The compute dispatch is exactly `ceil(bladeCount / 64)` workgroups.
- WGSL executes the existing Random123 Philox4x32-10 transform for each demanded `(bladeIndex, lane)` and writes the same 64-byte blade-instance layout consumed by the MAT030F vertex pipeline.
- Canonical `grass:cell:x:y` identities, batch ranges, exact retained signature, 4,096-cell limit, 65,536-blade limit, and 65,536-scanned-cell limit remain unchanged.
- Identical demand still preserves the retained packet object and uploads zero bytes. A camera move uploads only new cell descriptors plus sixteen parameter bytes; immutable blade geometry remains shared.
- Explicit `static_instances: false` now survives the display adapter and renderer, so a moved view actually redispatches changed grass rather than retaining stale instance bytes.
- Grass remains non-pickable as before. Non-grass and existing pickable packet paths do not enter the compute adapter.

## RED to GREEN

1. GPU packet tests failed because only 64-byte CPU instance arrays existed. `2734eeb` added bounded deterministic per-cell descriptors without sampling or allocating per-blade records.
2. WGSL contract tests failed because there was no grass compute source. `1b2b9ce` added Philox4x32-10, bounded lane transforms, and a CPU descriptor reconstruction oracle within `2e-6` of the prior f32 records.
3. Renderer tests failed because no compute pipeline, dispatch, retained update, or resource lifecycle existed. `3915b34` added all four and corrected explicit dynamic-instance handling.
4. Runtime tests still observed CPU batch records. `b411378` routed demand to the GPU descriptor factory and pinned exact upload receipts.
5. The first real capture rendered only the ground because the display adapter required `instances`. `db52f8c` preserved internal `grass_gpu` packets and the explicit dynamic-instance bit through the unified scene adapter.

## Efficiency result

Pinned horizon view (128 cells, 256 blades):

- draw packets remain `1`;
- first upload: 16,568 -> 6,344 bytes versus MAT030G, a 61.71% reduction;
- first upload: 47,104 -> 6,344 bytes versus expanded MAT030E, an 86.53% reduction;
- unchanged-view upload remains 0 bytes;
- camera-move upload is `48 * cellCount + 16` bytes.

Maximum bounded generation benchmark (4,096 cells, 65,536 blades; one warm-up, five alternating samples):

| Path | Mean | Std. dev. | CPU-upload bytes |
| --- | ---: | ---: | ---: |
| MAT030G CPU blade records | 3,506.83 ms | 490.30 ms | 4,194,488 |
| MAT030H GPU descriptors | 751.64 ms | 176.11 ms | 196,808 |

- CPU demand generation is 4.67x faster because it no longer runs eight Philox transforms and trigonometric trait transforms per blade.
- CPU-to-GPU upload is 95.31% smaller at the maximum bounded demand.
- This benchmark does not claim the compute shader itself is free or establish final frame throughput; it isolates demand generation and upload volume. Final GPU frame benchmarking still needs a longer multi-frame run rather than the two-frame capture helper.

## Executable evidence

Affected deterministic/random/material/display/renderer chain:

```text
node --test tests/js/vf-grass-blade-gpu-compute.test.mjs tests/js/vf-grass-material-instances.test.mjs tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-display-grass-gpu-pass-through.test.cjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-geom-grass-gpu-compute.test.mjs tests/js/vf-geom-grass-blade-instances.test.mjs tests/js/vf-geom-shared-grass-template.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 66; pass 66; fail 0
```

Real zero-light WebGPU capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-camera-demand-runtime-smoke.html tests/fixtures/grass-camera-demand-runtime-smoke.png 0 9406 grass_camera_demand_runtime_frame
```

- WebGPU compiled both the render and compute shaders with no initialization, shader, validation, provider, or runtime errors.
- The unified renderer retained one ground packet and one 256-instance `grass-blade-list` GPU batch.
- The transient PNG was 26,322 bytes with SHA-256 `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7`.
- The PNG is byte-identical to MAT030E CPU-expanded geometry, MAT030F CPU instances, and MAT030G CPU batching. It was visually checked and removed.
- Render evidence remained zero-light: zero active/planned lights and zero light assignments.

Repository suite under parallel test-runner load:

```text
npm test
tests 495; pass 491; fail 4
```

- Three inherited deterministic failures remain: generated HTML catalog drift and the two symbolic sign/endpoint failures.
- The additional failure was the unrelated 100,000-point timing threshold at 62.8 ms during the loaded suite. Its isolated rerun passed all 3 tests, with the same projection taking 21.36 ms. No grass-owned test failed.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-field.mjs` | `0a57de5d17511e5c5184d6cce7a2b41d2919134d` | `0626A89DC201613ADA5153F4210F3397BA9F7A7EC43C58C629515ECC56C26480` |
| `web/vf-ui/vf-grass-blade-gpu.mjs` | `186d3e98f91497b9ca3c68c2b0d8acd133a79461` | `51FBA0E9A1C34B5454CF12061A81740CB889484B85FAC9779E78735B1F9816D2` |
| `web/vf-ui/vf-grass-camera-demand-runtime.mjs` | `0481a16202c1c9e2df39dc658e65025007925266` | `8F83179EFF7582AC2FA7A7D616F22EB1F66622152EC36C44F6734181B02214A5` |
| `web/vf-ui/vf-display.js` | `be58d23cfa2a1fca3026cbf002834fba20c0595f` | `8D89E14B35E0D8C031145715706253774B3A7890652570534A79558A21BD90FF` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `0b000c65ef994f501cb817dea8016702384d233c` | `57AE0AAF4FC1BFF1C47EF4E8D141CBF368E8AF01148FDA64927CF9F8F6FB53E9` |
| `tests/js/vf-grass-material-instances.test.mjs` | `5d7fe2065f317cf795ac6fe60594edd8bbc5055c` | `9723215D28B2B0021F1E9D9D79ADA92DDD0DFD1655E11EF372CBCFFE3C5726BB` |
| `tests/js/vf-grass-blade-gpu-compute.test.mjs` | `73fa24f0cb803dbddd45df3bfc7603a1dad88a0f` | `69D9578B2D599764EF66168FF8A06938CF27298DDBCF1F7A35CB0435EF2A26CC` |
| `tests/js/vf-grass-camera-demand-runtime.test.mjs` | `e001c77768203cba1d3b157d52ba608011787049` | `A39FDE67F8D3BED68838CA596DB832FA903E1AFE12820F8F00E991EB489117C5` |
| `tests/js/vf-display-grass-gpu-pass-through.test.cjs` | `0dc6854f7ce1c862d88651bba1c821219b483cdf` | `E86E7D9493238A065EA6B6A6725023505134F1C5489D8EB597096F90B02F7DC6` |
| `tests/js/vf-geom-grass-gpu-compute.test.mjs` | `dd5cd179e13cbf5f8126a78e3afefe0b31a09ea9` | `F1824E417376DE393C11DB8913B37A92A3F508AB08983C73F3F3C1FEA952C392` |

## Remaining boundary

Per-cell multiscale material sampling is still performed on the CPU, while per-blade sampling now runs entirely in WGSL. Grass is still deliberately unlit, non-pickable, and absent from the shadow pass. The next isolated slice can add instanced grass shadow rendering without changing the pinned compute record or capture identity.

Recovery: drop commits after base `5e378a2`; no other worktree is required.
