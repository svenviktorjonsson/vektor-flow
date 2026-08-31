# MAT030E bounded grass-demand runtime evidence

Date: 2026-08-31

## Packet

- Base: `f4bfb2b07dfb0bd9eee6c6d38c170702c42a0de9`
- Branch: `codex/0.6/060-mat030e-grass-demand-runtime`
- Scope: horizon/far-bounded camera demand, latest-revision runtime coalescing, retained grass packet updates, and the isolated zero-light renderer fix.
- Public VKF syntax/API/schema changes: none.
- Owned paths:
  - `web/vf-ui/vf-grass-view-demand.mjs`
  - `web/vf-ui/vf-grass-camera-demand-runtime.mjs`
  - `web/vf-ui/geom/vf-geom-wgpu.js`
  - `tests/js/vf-grass-view-demand.test.mjs`
  - `tests/js/vf-grass-camera-demand-runtime.test.mjs`
  - `tests/js/vf-geom-clustered-light-wiring.test.mjs`
  - `tests/fixtures/grass-camera-demand-runtime-smoke.html`
  - `docs/evidence/060-mat030e-grass-demand-runtime.md`

## Observable contract

- A view ray that meets the grass plane before its configured maximum distance uses the exact plane intersection. A parallel, upward, or farther ray uses its finite far endpoint instead. Horizon views therefore produce a bounded convex cell footprint instead of throwing or expanding toward infinity.
- Calls without a maximum retain MAT030D behavior. The runtime requires a finite positive maximum and never allows a per-camera request to exceed it.
- Existing MAT030C limits remain unchanged: at most 4,096 cells, 65,536 blades, and 65,536 scanned cell candidates. Canonical cell identities and byte-stable refinement are preserved.
- `request({ revision, camera })` yields by default. Multiple requests before that task runs coalesce to the highest revision, and superseded demand never reaches the grass generator or retained renderer.
- Revisions at or below committed/pending work are reported as stale. An identical steady view performs zero generation, zero upload, and zero renderer request.
- A changed view retains shared packet objects by stable cell id and blade count, removes evicted ids, and uploads only new or refined packets. Upload bytes remain bounded by `bladeBudget * 184`.
- The horizon fixture coalesces revision 1 into revision 2, clips at 50 world units, selects 128 cells at detail level 1, and materializes 256 blades. Its first upload is 40,960 vertex bytes plus 6,144 index bytes, 47,104 bytes total.
- The clustered-light record buffer now reserves one complete 64-byte shader record when the scene has zero lights. Logical light count and evidence storage remain zero.

## RED to GREEN

1. The horizon test failed with `grass view frustum must face the grass plane`. `46555c2` added finite far clipping while keeping exact intersections for ground-facing rays.
2. The runtime suite failed because `vf-grass-camera-demand-runtime.mjs` did not exist. `ac3f02d` added latest-revision scheduling, steady-demand elision, retained packet reuse, bounded removal/upsert deltas, and upload receipts.
3. The isolated zero-light test observed a 16-byte record buffer against the shader's 64-byte minimum. `5c9edd8` changed the empty packed record from four to sixteen floats and returned clustered lighting plus renderer evidence to green.
4. The capture contract failed because no runtime fixture existed. `af5c15f` added the real horizon/coalescing fixture with `lights: []` and fed retained packets into the offscreen WebGPU renderer.

## Executable evidence

Affected material/runtime/renderer chain:

```text
node --test tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-rock-camera-demand-runtime.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 41; pass 41; fail 0
```

Real renderer capture, launched only through the existing Edge `--headless=new` helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-camera-demand-runtime-smoke.html tests/fixtures/grass-camera-demand-runtime-smoke.png 0 9403 grass_camera_demand_runtime_frame
```

Observed committed-fixture capture evidence:

- WebGPU initialized off-screen at 1,236 x 725 with no initialization, shader, provider, runtime, or validation failures.
- Frame sequence and adapter revision reached `2`; the renderer retained the ground plus exactly 128 horizon-demanded grass packets.
- Every grass packet contained 80 vertex values and 12 indices, matching two blades per cell and the 256-blade receipt.
- Renderer evidence reported zero active lights, zero planned lights, zero assignments, and logical light-record storage of zero bytes while the valid 64-byte sentinel record remained bound.
- `captureGeomFrameDataUrl` returned a PNG data URL of length 35,118.
- The transient 26,322-byte PNG had SHA-256 `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7`, was visually checked for the far-clipped horizon grass band, and was removed. No generated binary remains.

Repository suite:

```text
npm test
tests 483; pass 480; fail 3
```

The same three inherited integration failures remain outside owned paths:

- generated HTML component catalog is stale;
- symbolic document scope expected `8`, observed `-8`;
- named symbolic function/constant geometry expected `[-5, 625]`, observed `[-5, -624]`.

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-view-demand.mjs` | `29aca6e6071c7aba2a5e724eb2cf63ef06d02950` | `B6D543ABE249644A118F7E8999E9F065AAFA948C734174AE9F4D374BE02AC7C7` |
| `web/vf-ui/vf-grass-camera-demand-runtime.mjs` | `abce2fb020b0223ff0e303aeea7363fafd44416e` | `6DD29DBE1AB9CF61296E2685A0E86BB8C4D0244DB71C81CC856DA277E83A527F` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `016d9b1ac7372293bddc97b7fc8776862ae3bb56` | `CB58A9837565C43D56147397FD278AD78C1E269BC3BE46433F4053BE3496DA9D` |
| `tests/js/vf-grass-view-demand.test.mjs` | `fb9654df2b74ff84c292825866059733f759a28a` | `474F44D7A4B180B07014541A7F2CADF5572E4B9B3478C7310D26A7CE2EC1B4A6` |
| `tests/js/vf-grass-camera-demand-runtime.test.mjs` | `a4be6db4a40c6a0739719770f03e08f396367377` | `7934574018713C107529F465B0522181B2DEC36BCC111B6A39232EC68B76C6BE` |
| `tests/js/vf-geom-clustered-light-wiring.test.mjs` | `7d6c679c6438f257c4aec48e9765df72820c1fab` | `5872ECAD23A2C0045B5D899354767582AAB3CCF065A430E78072DACE9E688E77` |
| `tests/fixtures/grass-camera-demand-runtime-smoke.html` | `56b886bde02bf7e30e541064b5dcc959ace572f4` | `FE5840C7EB1C9499C3459ED1E5518E6CF4113D2088CB46D0162E36A376E41721` |

## Remaining boundary

The scheduled work is deliberately bounded and synchronous once it begins; a newer revision can supersede queued work but does not interrupt an already-running packet generation. The current typed-quad packets also re-upload a whole changed cell when detail grows, despite preserving the established byte prefix. A later internal instanced/WGSL blade packet can make generation interruptible and append only new blade instances without changing this demand or identity contract.

Recovery: drop commits after base `f4bfb2b`; no other worktree is required.
