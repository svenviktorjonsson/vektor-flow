# 040-G01G geometry-emitter shader evidence

Recorded: 2026-08-31 10:21:53 +02:00

## Packet identity

- Release: 0.4.0, GFX-010 clustered-light foundation
- Branch: `codex/0.4/040-g01g-geometry-emitter-shader`
- Base commit: `e9aa23b2cf996114646c1bc2a145d7835ae8478b`
- Implementation commit: `70ac725981e803c787f91dd83fc8d39b55462ef4`
- Camera-seam test commit: `86890cf835b497f611e3d742d9199f2a078e4c22`
- Implementation tree: `ddf443718fcb3e488f68818b729a2527d16e4714`
- Environment: Windows x64, Node.js v24.11.0, Microsoft Edge 152

This packet changes no VKF syntax, public API, public scene schema, material
schema, or caller-visible shader binding. Geometry emitters enter through the
renderer-private `_geometry_emitters` hierarchy record only.

## RED evidence

The new focused tests first ran 28 tests with 23 passing and five expected
failures. They pinned:

- geometry influence-range projection rather than source-polygon-only bounds;
- a bounded internal polygon record appended after the legacy four slots;
- stable packing of centroid, normal, area, radius, and two-sided metadata;
- one-sided and two-sided diffuse contribution without specular; and
- a shared WGSL geometry-emitter factor in the clustered receiver path.

After implementation, the full suite exposed one affected camera-seam source
test whose old regex required the planner to receive `sceneLights` directly.
The follow-up commit updates that seam to require camera-aware planning after
private geometry records are composed.

## GREEN evidence

Focused command:

```text
node --check web/vf-ui/geom/vf-geom-wgpu.js
node --check web/vf-ui/geom/vf-clustered-light-shading-oracle.mjs
node --check web/vf-ui/geom/vf-light-view-bounds.mjs
node --test tests/js/vf-clustered-light-plan.test.mjs tests/js/vf-clustered-light-view-plan.test.mjs tests/js/vf-light-view-bounds.test.mjs tests/js/vf-geom-clustered-light-shader.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-render-evidence.test.cjs
```

Result: 38 tests passed, 0 failed. The affected projected-bounds seam test,
JavaScript syntax checks, and `git diff --check` also passed.

Observable behavior:

- at most 32 internal geometry patches are retained per scene;
- each patch is finite, non-degenerate, has three through eight world-space
  points, and packs into the existing 192-byte clustered-light record;
- patches are reduced deterministically to centroid, Newell normal, triangle-
  fan area, radius, range, color, intensity, and a two-sided bit;
- scenes with fewer than four direct lights reserve zero-intensity legacy slots,
  so geometry records always start at light ID four;
- camera-aware planning conservatively expands geometry bounds by the declared
  influence range and can cull unrelated direct lights;
- retained patches use bounded attenuation, receiver cosine, emitter-facing
  cosine, and area scaling in the shared opaque/transparent receiver path;
- geometry emitters are diffuse-only and unshadowed; and
- the original first-four uniform, specular, contact-shadow, and shadow-map
  behavior is unchanged.

## Off-screen hardware capture

The repository's existing `VfDisplay.__test.captureGeomFrameDataUrl(frameId)`
readback was exercised through `tests/helpers/capture_mirror_scene.js`. Edge was
launched only in explicit off-screen GPU mode at `-32000,-32000`, with
background throttling disabled. A visible browser launch is not an accepted
verification path.

Capture command:

```text
$env:VF_CAPTURE_OFFSCREEN_GPU='1'
$env:VF_CAPTURE_SUMMARY='1'
$env:VF_CAPTURE_EXTRA_REDRAWS='3'
node tests/helpers/capture_mirror_scene.js tests/fixtures/clustered_geometry_emitter_capture.html docs/evidence/artifacts/040-g01g-geometry-emitter-offscreen.png 0 9361 clustered_geometry_emitter_frame
```

The real renderer reported:

```json
{
  "offscreenGpu": true,
  "hasAdapter": true,
  "runningRenderers": 1,
  "captureMode": "frame",
  "frameWidth": 961,
  "frameHeight": 664,
  "plannedLights": 5,
  "lightClusterAssignments": 720,
  "lightClusterOverflowAssignments": 0,
  "lightRecordStorageBytes": 960,
  "captureDataUrlOk": true
}
```

The fixture makes all four public point lights zero-intensity and injects one
renderer-private, downward-facing geometry patch as ID four. Therefore the
captured center highlight cannot come from the legacy lights.

Pixel-oracle command:

```text
tests/helpers/assert_geometry_emitter_capture.ps1 -Path docs/evidence/artifacts/040-g01g-geometry-emitter-offscreen.png
```

Result:

```json
{
  "width": 961,
  "height": 664,
  "centerMeanLuma": 254.379,
  "leftMeanLuma": 3.0,
  "rightMeanLuma": 3.0,
  "cornerMeanLuma": 3.0,
  "sha256": "895bc408041ff20bfc0bef9f42b4c2e782c93841567a60d5490b13fc574a2b7a",
  "bytes": 67937
}
```

The oracle requires center luma at least 70, every sampled exterior region at
most 25, and at least 60 luma units of separation. No test-owned Edge process
remained after capture.

## Full JavaScript suite

```text
npm test
```

Result: 387 tests, 384 passed, 3 failed. Every clustered-light, geometry-
emitter, and affected renderer seam passed. The same unrelated integration-
baseline failures remain:

- stale generated HTML component catalog;
- symbolic document result `-8` versus expected `8`; and
- symbolic literal geometry result `-624` versus expected `625`.

## Honest limitations

- This is an internal hierarchy record, not a new public geometry-light API.
- The shader evaluates one bounded centroid/normal/area approximation per
  patch. It does not yet integrate exact polygon solid angle or spatial samples.
- Additional geometry emitters do not cast shadow maps and do not receive
  occlusion from scene geometry.
- Patches with more than eight vertices require upstream bounded subdivision;
  this packet does not implement that hierarchy builder.
- Real-GPU verification used explicit off-screen hardware mode because the
  host's headless Edge adapter is unavailable. No visible capture was run.

## Source hashes

| Source | Git blob | SHA-256 |
|---|---|---|
| `web/vf-ui/geom/vf-geom-wgpu.js` | `2548402e5e19d5b383e5ec78295799e291cb9c19` | `e136899c02e9d6f52a9d371ddef098604588cd19a0b076a0a4a4ab9c572f8c20` |
| `web/vf-ui/geom/vf-clustered-light-shading-oracle.mjs` | `cef11814420003af19de67c0aef46dc3858fb054` | `a7f847869f4e133947ec7f0eefacb459fc8eb3f5dd7efe3214ac6baeef899ebd` |
| `web/vf-ui/geom/vf-light-view-bounds.mjs` | `80b336f79f014c8ad32de3d66bc23e1b065417c7` | `e31d059d10c606aeaceb04088ac8887267bbe81539efc2ddc546bda4f788aa6a` |
| `tests/js/vf-geom-clustered-light-shader.test.mjs` | `94dfe44cf6621aa4344a036fffa067fcc449cc96` | `1e7edb0bf8d5a3eeec9e88b55d7bd57a5e3743b5c07e72b751e8a9088c99526f` |
| `tests/js/vf-geom-clustered-light-wiring.test.mjs` | `2d714eb6b786f58c76cdb87b1eb11f4dd263de47` | `43b8831f0b5a0ef06efa3b27f6ab728acf315d8ac7b60fa253a1103615aeb84a` |
| `tests/js/vf-light-view-bounds.test.mjs` | `40346729d8f84eca539f0501cf0508a6dc9ebd32` | `6b63aba9b54463bdbde905f6b03e14b1b06b0e58ddc0b193372b02d7d38ed6b6` |
| `tests/js/vf-geom-projected-bounds-seams.test.cjs` | `75f60da70839d7f2c7af7f208441c88ee5788cee` | `8083d046ba3ccbcce845a1f5982d908a0edfa87aff424930132efad8c75d893e` |
| `tests/fixtures/clustered_geometry_emitter_capture.html` | `2d0e262935fb7e670ee0afbe6cecae4a6fdd34a4` | `d31cebecb40453dfa3418c041107f516df106fd6c6611721f4d3290b7f8aa0d7` |
| `tests/helpers/assert_geometry_emitter_capture.ps1` | `2babf7c9d01d59527c82f8aa60c7311fb8de286a` | `52e10b99b16605635a22aa00fb9a3eb3918496987b7e40c9c84f74a25c675e7f` |
| `docs/evidence/artifacts/040-g01g-geometry-emitter-offscreen.png` | `89929d7748dcab752d7845195baff5c0ea6bf4d7` | `895bc408041ff20bfc0bef9f42b4c2e782c93841567a60d5490b13fc574a2b7a` |
