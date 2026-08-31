# MAT030I instanced grass shadow evidence

Date: 2026-08-31

## Packet

- Base: `57c25d3a84f9a8bbb56d6a2922da425bc075cfbd`
- Branch: `codex/0.6/060-mat030i-grass-shadows`
- Scope: feed MAT030H's retained GPU blade-instance buffer into the existing depth shadow pass.
- Public VKF syntax/API/schema changes: none. The shadow flag, retained signature, shader entry points, and conservative bounds are internal renderer packet details.

## Observable contract

- GPU grass packets explicitly cast shadows while remaining non-pickable and unlit in the main color pass.
- The shadow WGSL reconstructs the exact same position from the same 64-byte instance record as the color WGSL. It does not resample randomness or allocate another blade buffer.
- One compatible grass batch produces one indexed instanced shadow draw per shadow-map update, independent of the bounded blade count.
- Shadow fitting reads only the bounded per-cell descriptor records. It uses eight conservative aggregate corners rather than materializing per-blade positions on the CPU.
- Bounds are cached by model matrix plus the retained cell signature. Unchanged demand checks the cache before scanning descriptors.
- Existing limits remain 4,096 cells, 65,536 blades, and 65,536 scanned candidate cells. Canonical cell IDs, batch ranges, and Philox sampling are unchanged.
- A changed retained signature invalidates both shadow-map and aggregate-bounds caches. Unchanged demand preserves zero grass descriptor upload and the retained packet object.

## RED to GREEN

1. The material/display tests failed because grass did not declare shadow intent and the display discarded its retained signature. `61778f4` preserves both.
2. Shadow source tests failed because the depth pass only understood ordinary vertex buffers. `8471ba7` adds two grass shadow entry points, matching pipelines, the existing instance buffer binding, one instanced draw, and conservative cell bounds.
3. The first offscreen attempt caught the grass input structure in the wrong WGSL module. The corrected test now extracts `SHADOW_SHADER` itself; a real WebGPU compile then completed without validation errors.
4. `8b76eab` moves the stable-bounds cache check ahead of descriptor traversal.
5. `b895dd5` adds a deterministic one-light capture fixture with a shadow-receiving ground plane.

## Bounded performance evidence

The deterministic lit fixture demands 96 cells and 768 blades. It retains two scene packets and renders the grass shadow through one compatible batch.

Two independent two-frame offscreen captures gave identical pixels. The first frame generated the shadow map; the second frame reported one shadow-cache hit and zero new shadow draws. Diagnostic timings were:

| Capture | cold shadow prepare | cached shadow prepare | cold shadow submit | cached shadow submit |
| --- | ---: | ---: | ---: | ---: |
| A | 18.8 ms | 4.8 ms | 0.1 ms | 0.0 ms |
| B | 16.0 ms | 4.3 ms | 0.1 ms | 0.0 ms |

These are bounded two-frame diagnostics on this host, not a final throughput benchmark. They establish one GPU depth draw, cache reuse, and no per-blade CPU shadow expansion. The existing runtime test independently keeps unchanged-view grass upload at zero bytes.

## Executable evidence

Affected material/display/renderer chain:

```text
node --test tests/js/vf-grass-blade-gpu-compute.test.mjs tests/js/vf-grass-material-instances.test.mjs tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-demand-random.test.mjs tests/js/vf-demand-random-wgsl.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-display-grass-gpu-pass-through.test.cjs tests/js/vf-display-rock-material-pass-through.test.cjs tests/js/vf-geom-grass-gpu-compute.test.mjs tests/js/vf-geom-grass-blade-instances.test.mjs tests/js/vf-geom-grass-shadow.test.mjs tests/js/vf-geom-shared-grass-template.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 69; pass 69; fail 0
```

Zero-light pixel-parity capture:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-camera-demand-runtime-smoke.html <transient.png> 0 9408 grass_camera_demand_runtime_frame
```

- PNG: 26,322 bytes; SHA-256 `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7`.
- Byte-identical to MAT030E, MAT030F, MAT030G, and MAT030H.
- Zero active lights, zero shadow draws, and no WebGPU, shader, provider, or runtime errors.

Lit shadow capture, repeated on ports 9409 and 9410:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-instanced-shadow-smoke.html <transient.png> 0 9409 grass_instanced_shadow_frame
```

- Both PNGs: 166,389 bytes; SHA-256 `8DFF2FF3AED1BB0E52C4DBC4898C519F0EA6960BB154597B497275C6F28E8666`.
- One active/planned point light, 768 grass instances, one cached shadow map on the observed second frame, and no WebGPU, shader, provider, or runtime errors.
- The capture was visually checked; individual blade silhouettes and projected ground shadows are visible. Transient PNGs were removed.

Repository suite:

```text
npm test
tests 498; pass 495; fail 3
```

The same three inherited failures remain: generated HTML catalog drift and the two symbolic sign/endpoint failures. No MAT030I-owned test failed.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-field.mjs` | `6f65bba14e1ee557bc917c40e92bafdd1a46ba3e` | `06524944D98CCA3F9786495F9F6228667AB725A8934E721394B4DD9281AB5730` |
| `web/vf-ui/vf-display.js` | `2d25ab0eb938f0dd0af386696516f8ac27f88d54` | `F5A2E6DB89BB8F47BC24CAE548999A9A1FF9E8E9C67F267B7C14F739A5F3557F` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `d1a5fac3cccd4d5f8381753ceed914990d42ca8f` | `2908741CB45CB82FD9A3A4D253F66F6876427F8217C6DE894DAB1C71F73F61CF` |
| `tests/js/vf-geom-grass-shadow.test.mjs` | `bad85f1b7004af91c926271897e99142ecb24ea2` | `7F74643997B7555572F2A8A18C80DE6242D09DE664E4422FF84B64380ADCEBB0` |
| `tests/fixtures/grass-instanced-shadow-smoke.html` | `e0d2106e933628b37d87543d229666cb14988582` | `8910ABFE94D856D2DBC5E59BF2B2ED1B7CE15665DFD38D5529E389B7CC15FE96` |

## Remaining boundary

Grass currently casts opaque blade silhouettes. Alpha-tested blade textures, wind-deformed shadow parity, cascaded/directional far-field shadows, and grass receiving the lighting model belong to later isolated material packets. MAT030I does not select or freeze those policies.

Recovery: drop commits after base `57c25d3`; no other worktree is required.
