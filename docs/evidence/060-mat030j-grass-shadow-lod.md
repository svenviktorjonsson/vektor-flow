# MAT030J grass shadow distance LOD evidence

Date: 2026-09-01

## Packet

- Base: `bf0b900c0474a2eeaa97d53591f6303744645ca0` (MAT030I).
- Branch: `codex/0.6/060-mat030j-grass-shadow-lod`.
- Scope: derive an internal shadow density from the existing camera-selected grass detail and use it in the instanced depth pass.
- Public VKF syntax/API/schema changes: none. The distance policy and the two shadow-count fields remain internal renderer descriptors and are not promoted as material controls.

## Observable contract

- Camera/frustum demand remains the sole source of grass cells and color detail. The shadow path does not scan world space or create a second demand traversal.
- Color detail levels `0..4` retain `1, 2, 4, 8, 16` blades per cell. Internal shadow density is `1, 1, 2, 4, 8`, always retaining at least one stable blade from each demanded cell.
- Each shadow level selects the first stable blade identities from every cell. Refinement appends detail and never changes an already selected identity.
- Cell IDs, retained packet signature, one compatible batch, 4,096-cell cap, 65,536-color-blade cap, and bounded shadow fitting are unchanged.
- The shadow vertex shader maps the compact shadow instance index into the existing color instance buffer. There is no second blade buffer, second Philox compute dispatch, or additional descriptor upload.
- Unchanged camera demand retains the existing packet/runtime and therefore remains zero-upload and zero-compute-dispatch.
- Zero-light rendering does not enter the shadow pass and remains byte-identical to MAT030E through MAT030I.

## RED to GREEN

1. `23e42ab` pins the internal demand-to-shadow density mapping and exact near/far bounded counts.
2. `9357020` first proved a compact shadow-instance path and exact per-cell prefixes in the renderer.
3. `0308d2b` adds near/far offscreen scenes and exposes their internal evidence without changing runtime contracts.
4. `609a580` removes the provisional extra buffer/compute pass. The shadow vertex shader now remaps each compact instance to the existing stable color instance. Real WebGPU captures remained pixel-identical across the refactor.

## Bounded performance evidence

| Demand | Cells | Color blades | Shadow blades | Shadow vertex reduction | Shadow draws |
| --- | ---: | ---: | ---: | ---: | ---: |
| Near fixture, detail 3 | 96 | 768 | 384 | 50% | 1 cold / 0 cached |
| Far fixture, detail 2 | 96 | 384 | 192 | 50% | 1 cold / 0 cached |
| Maximum packet, detail 4 | up to 4,096 | up to 65,536 | up to 32,768 | 50% | 1 per light update |

Detail 0 deliberately keeps one of one blade per cell, so its reduction is 0%; it preserves sparse distant shadow coverage. All higher current detail levels reduce shadow vertex invocations by 50%.

The final path uses the same three buffers as MAT030I: bounded cell descriptors, the color instance buffer, and a 16-byte parameter uniform. It adds zero GPU storage bytes, zero CPU upload bytes, and zero compute workgroups relative to the existing color-instance generation. One integer cell/local remap is added per shadow vertex. The cached second capture frame reports one shadow-cache hit and no new shadow draw.

These are structural bounded-work measurements, not a final frame-throughput benchmark. The two-frame host diagnostics were noisy under parallel headless captures, so they are not used to claim a timing speedup.

## Executable evidence

Affected material/display/renderer chain:

```text
node --test tests/js/vf-grass-blade-gpu-compute.test.mjs tests/js/vf-grass-material-instances.test.mjs tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-display-grass-gpu-pass-through.test.cjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-geom-grass-gpu-compute.test.mjs tests/js/vf-geom-grass-blade-instances.test.mjs tests/js/vf-geom-grass-shadow.test.mjs tests/js/vf-geom-shared-grass-template.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 69; pass 69; fail 0
```

Zero-light pixel-parity capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-camera-demand-runtime-smoke.html <transient.png> 0 9431 grass_camera_demand_runtime_frame
```

- PNG: 26,322 bytes; SHA-256 `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7`.
- Exact MAT030E-through-MAT030I hash; zero lights, zero shadow draws, and no WebGPU/shader/runtime errors.

Near capture repeated independently, then repeated again after buffer reuse:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-instanced-shadow-smoke.html <transient.png> 0 9432 grass_instanced_shadow_frame
```

- PNG: 154,171 bytes; SHA-256 `165AF490C81AE4BEEF87E1D3DBED489D67B86BEB364C4B1888775F8EC5F0BE8B`.
- All three runs matched; 96 cells, 768 color blades, 384 shadow blades, one active light, and a cached second frame.

Far capture repeated independently, then repeated again after buffer reuse:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-shadow-lod-far-smoke.html <transient.png> 0 9433 grass_shadow_lod_far_frame
```

- PNG: 81,011 bytes; SHA-256 `612F7A80ACA9DBE6670FAC3EE90E3C65C3C251FE6FAB7F40599075E7CC9315F6`.
- All three runs matched; 96 cells, 384 color blades, 192 shadow blades, one active light, and a cached second frame.
- Near, far, and zero-light images were visually checked. Transient PNGs were removed.

Repository suite after the final buffer-reuse refactor:

```text
npm test
tests 498; pass 495; fail 3
```

The same inherited generated HTML catalog drift and two symbolic sign/endpoint failures remain. No MAT030J-owned test failed.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-field.mjs` | `2418d7a3750f00204084f893f389677fbcda8f8d` | `4ADED76162FA1F2981A35279BF7F0B87963DF86060C45E19D3724117D31CC978` |
| `web/vf-ui/vf-grass-blade-gpu.mjs` | `2b567bda77ab40a3088672b93901527b1663e8aa` | `B913E6941A82D05AAAF132F0CFC15CF2C4A7D0B600EB246E4A6EF3938B14701A` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `af61db8f621be5df3215646dec21fada23e65cc5` | `7B09F7C041BD04986F8D58EDE3EE096F6D31F1947043F70BA6F8B093F06017A8` |
| `tests/js/vf-grass-view-demand.test.mjs` | `642e96861c035b3795280f26dd6d22be0f8e6857` | `EED94246CBC7A50853DDD501F36612649BC758DEDC02DD2641E19FD61F459332` |
| `tests/js/vf-geom-grass-shadow.test.mjs` | `bdaa04d219a508e308c57d2bb1348d530022b3b0` | `593973C7DC012E58E96A4F5BCA9D93FFAABE02ED04D7AC5F7B083234F5A784B0` |
| `tests/fixtures/grass-instanced-shadow-smoke.html` | `032718c01fe4b989d1eae80ea44c69784d24c4aa` | `F098E9B0548167CE700EB89E2E77FC644F30DF334643F0D99C24F98CEE2A1A10` |
| `tests/fixtures/grass-shadow-lod-far-smoke.html` | `01806dafd89f9bb4564c096aab8af5a0f2df18c3` | `161DC2121AA9DFFBC425BDCF4579EE823D989C83DD1929A8D0A6CCEBF276F52C` |

## Remaining boundary

This packet does not expose a user-selectable shadow LOD policy, perform timing-based adaptive changes, add alpha-tested blade textures, or add directional cascades. Those choices need separate packets; promoting the internal density mapping requires Viktor's language/API decision.

Recovery: drop commits after base `bf0b900`; no other worktree is required.
