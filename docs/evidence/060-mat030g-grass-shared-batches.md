# MAT030G shared and batched GPU grass evidence

Date: 2026-08-31

## Packet

- Base: `f33209f9f8017ccbf769f5b14977fe9d555021ae`
- Branch: `codex/0.6/060-mat030g-grass-shared-batches`
- Scope: reference-counted immutable grass template buffers and one retained GPU draw packet for all compatible cells in the bounded view.
- Public VKF syntax/API/schema changes: none. The batch factory, metadata, and renderer cache are internal reference contracts.

## Observable contract

- Compatible visible grass cells retain canonical `grass:cell:x:y` identities in `cell_ids` and exact instance ranges while rendering through one stable `grass:view-batch:v1` packet.
- Concatenated instance records preserve the prior canonical cell order and every deterministic 64-byte blade record without alteration.
- The four-vertex/six-index blade template remains the same immutable typed-array identity. WebGPU acquires one reference-counted vertex buffer and one index buffer for that template rather than allocating a copy for each compatible part.
- A camera move with unchanged capacity replaces the batch only when its exact retained signature changes. It uploads instance records only; shared template bytes are not uploaded again.
- Identical demand preserves the retained packet object and produces zero packets, blades, or bytes of steady-state upload.
- Grass remains non-pickable as in MAT030F, so batching removes no supported pick identity. Non-grass meshes and all existing pickable paths bypass the grass template cache.
- The inherited limits remain: 4,096 visible cells, 65,536 blades, and 65,536 scanned cells. Batching cannot expand work beyond those demand caps.

## RED to GREEN

1. Shared-buffer tests failed because the renderer had no acquisition/release seam and allocated every part independently. `cef85d8` added typed-array-identity caches with last-reference destruction, scoped only to static `grass-blade-list` templates.
2. Batch tests failed because no compatible-cell batch factory existed. `b702f59` added canonical record concatenation, stable cell ranges, an exact retained signature, and single-template upload accounting.
3. Runtime tests still observed 32 separate packets and per-cell retention. `2c34eb1` routed view demand through one batch, retained it only on exact signature equality, and excluded already-shared template bytes from camera-move upload receipts.

## Efficiency result

For the pinned horizon capture (128 cells and 256 blades):

- draw packets: 128 -> 1;
- bounded first upload: 39,936 -> 16,568 bytes versus MAT030F, a 58.51% reduction;
- bounded first upload: 47,104 -> 16,568 bytes versus expanded MAT030E geometry, a 64.82% reduction;
- unchanged-view upload: 0 bytes;
- camera-move upload: instance records only (`64 * bladeCount`), with no vertex/index template re-upload.

## Executable evidence

Affected material/runtime/renderer chain:

```text
node --test tests/js/vf-grass-material-instances.test.mjs tests/js/vf-grass-camera-demand-runtime.test.mjs tests/js/vf-grass-view-demand.test.mjs tests/js/vf-grass-material-field.test.mjs tests/js/vf-conditioned-distribution.test.mjs tests/js/vf-spatial-correlation.test.mjs tests/js/vf-geom-grass-blade-instances.test.mjs tests/js/vf-geom-shared-grass-template.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-retained-part-identity.test.cjs tests/js/vf-geom-render-evidence.test.cjs
tests 43; pass 43; fail 0
```

Real zero-light WebGPU capture, launched through the existing off-screen Edge helper:

```text
node tests/helpers/capture_mirror_scene.js tests/fixtures/grass-camera-demand-runtime-smoke.html tests/fixtures/grass-camera-demand-runtime-smoke.png 0 9405 grass_camera_demand_runtime_frame
```

- The renderer retained one ground packet plus one 256-instance grass batch.
- The transient PNG was 26,322 bytes with SHA-256 `4D51B1365A376B258829505AEFDA8D9561A404D5AA90441EE557EE40322D77E7`.
- Its bytes exactly match MAT030E expanded geometry and MAT030F per-cell instancing. It was visually checked and removed.
- The scene used zero lights and exercised the prior zero-light storage-buffer regression path without validation or runtime errors.

Repository suite:

```text
npm test
tests 489; pass 486; fail 3
```

The same three inherited failures remain outside owned paths: generated HTML component catalog drift, symbolic scope sign (`8` expected, `-8` observed), and named symbolic geometry endpoint (`625` expected, `-624` observed).

## Content hashes

| Path | Git blob | working-tree SHA-256 |
| --- | --- | --- |
| `web/vf-ui/vf-grass-material-field.mjs` | `cf655eb5d1a15f6beaa19f84e352691a584fd811` | `1965451790B849084AD5131CDDB5912793892EEA21E92670153A9DE9C4268121` |
| `web/vf-ui/vf-grass-camera-demand-runtime.mjs` | `e6d6e74aa3116574f8a94474f2d8a033d1f4c0ff` | `AAAB7BAC6CFFE6432DF84CF47EBA6836C2EACA25197D81D8FA5A62BC5657EC47` |
| `web/vf-ui/geom/vf-geom-wgpu.js` | `207b527b1e8912ade8521ba715ce8a1429a2f754` | `0F1D0D63297DB61EDEFF0FEAAC4FBD9DB6650B39AE1426D799E691B15526FF00` |
| `tests/js/vf-grass-material-instances.test.mjs` | `04499b04ca5550f11d97a220388345f3938300d3` | `2430B9BB198D68C47233EB62DDCA38BA779AE5FD18318A6B12F850D48E0CD95E` |
| `tests/js/vf-grass-camera-demand-runtime.test.mjs` | `cbc2bd4e91228119902e2b5ef3f1ee35fd38dcfe` | `1337C0D81E713482EDC072207DC9A1274DAF0DA5BBF0CDD295EC7143377F0289` |
| `tests/js/vf-geom-shared-grass-template.test.mjs` | `e24d82eed1c8a7f8d7f9974a3bc7e6102102239d` | `AF03D3D9D09E25816330EAA3CAD35F16A5DE9C6ADE6B0173DC9185CC6CE14597` |

## Remaining boundary

Blade traits are still generated as CPU instance records. The next isolated packet can move the already-pinned Philox/conditioned sampling oracle into WGSL or add instanced grass shadow/pick passes, while retaining MAT030G batch identity, caps, and capture hash.

Recovery: drop commits after base `f33209f`; no other worktree is required.
