# 040-G01F projected aperture shader evidence

Recorded: 2026-08-31 09:46:15 +02:00

## Packet identity

- Release: 0.4.0, GFX-010 clustered-light foundation
- Branch: `codex/0.4/040-g01f-projected-aperture-shader`
- Base commit: `a3203061d2a1b61020f1e22841cfa51f9f1c5a3e`
- Implementation commit: `bd339c723cf77978ee2f506fbe2fc3959c5d0c69`
- Implementation tree: `1e44783871c0e9103ea833edac1e340c82592e6f`
- Environment: Windows x64, Node.js v24.11.0, Microsoft Edge 152

This packet changes no VKF syntax, public API, scene schema, material schema,
or shader binding visible to callers.

## RED evidence

The focused shader test first failed before implementation because
`vf-clustered-light-shading-oracle.mjs` did not export
`projectedApertureFactor`. The existing renderer source contract also still
contained the explicit `kind >= 1.5` skip for retained lights after ID three.

After widening the internal record, the existing storage-wiring test failed
`1152 !== 384`, pinning the record stride change before its assertions were
updated to inspect the fifth projected record's aperture header and points.

## GREEN evidence

Focused command:

```text
node --test tests/js/vf-clustered-light-plan.test.mjs tests/js/vf-clustered-light-view-plan.test.mjs tests/js/vf-light-view-bounds.test.mjs tests/js/vf-geom-clustered-light-shader.test.mjs tests/js/vf-geom-clustered-light-wiring.test.mjs tests/js/vf-geom-render-evidence.test.cjs
```

Result: 33 tests passed, 0 failed. JavaScript syntax checks and
`git diff --check` also passed.

Observable behavior:

- clustered records retain the original first 16 floats and add eight vec4
  aperture fields: four planar header vectors plus four packed vec2 pairs;
- each record is 192 bytes and supports at most eight aperture points;
- missing aperture data still yields zero projected contribution rather than
  silently turning the light into a point light;
- retained projected IDs four and above use the same bounded planar aperture,
  receiver-side, hard/soft edge, attenuation, and diffuse rules as the legacy
  path;
- projected lights remain excluded from the Blinn-Phong specular term;
- the shared receiver function feeds both opaque and transparent triangle
  pipelines; and
- legacy IDs zero through three retain their unchanged uniform aperture,
  shadow-map, contact-shadow, diffuse, and specular blocks.

## Off-screen hardware capture

The repository's existing `VfDisplay.__test.captureGeomFrameDataUrl(frameId)`
readback was exercised through `tests/helpers/capture_mirror_scene.js`. The
helper now has two safe modes only: its existing headless mode, or explicit
off-screen GPU mode. Off-screen mode launches Edge at `-32000,-32000`, disables
background throttling, and never permits a visible browser window. Failed
startup paths also close the test browser before returning.

Capture command:

```text
$env:VF_CAPTURE_OFFSCREEN_GPU='1'
$env:VF_CAPTURE_SUMMARY='1'
$env:VF_CAPTURE_EXTRA_REDRAWS='2'
node tests/helpers/capture_mirror_scene.js tests/fixtures/clustered_projected_aperture_capture.html docs/evidence/artifacts/040-g01f-projected-aperture-offscreen.png 0 9355 clustered_projected_aperture_frame
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
  "lightClusterAssignments": 864,
  "lightClusterOverflowAssignments": 0,
  "lightRecordStorageBytes": 960,
  "captureDataUrlOk": true
}
```

The fixture makes the first four lights zero-intensity and uses a projected
light as ID four. Its transparent aperture mesh is 1.5 by 1.5 units between
the light and an 8 by 8 receiver. Therefore only the fifth light can explain
the captured center/exterior contrast.

Pixel-oracle command:

```text
tests/helpers/assert_projected_aperture_capture.ps1 -Path docs/evidence/artifacts/040-g01f-projected-aperture-offscreen.png
```

Result:

```json
{
  "width": 961,
  "height": 664,
  "centerMeanLuma": 128.483,
  "leftMeanLuma": 3.0,
  "rightMeanLuma": 3.0,
  "cornerMeanLuma": 3.0,
  "sha256": "116a2c0dfc9022766f33e552ee93c3eb488e493c7727ac591735a5b6a8a30dac",
  "bytes": 43307
}
```

The oracle requires center luma at least 80, every sampled exterior region at
most 20, and at least 80 luma units of separation. No test-owned Edge process
remained after capture.

## Full JavaScript suite

```text
npm test
```

Result: 382 tests, 379 passed, 3 failed. Every clustered-light and capture
oracle check passed. The same unrelated integration-baseline failures remain:

- stale generated HTML component catalog;
- symbolic document result `-8` versus expected `8`; and
- symbolic literal geometry result `-624` versus expected `625`.

## Honest limitations

- Only the first four lights have shadow maps and contact shadows. Additional
  projected lights are aperture-clipped and unshadowed.
- This packet handles planar projected apertures only. It does not add
  arbitrary geometry-emitter records.
- Edge's headless adapter remains unavailable on this host. Real-GPU capture
  therefore uses the explicit off-screen hardware mode described above; a
  visible browser launch is not an accepted verification path.

## Source hashes

| Source | Git blob | SHA-256 |
|---|---|---|
| `web/vf-ui/geom/vf-geom-wgpu.js` | `e2963c1afff67526a7edafe87d2671fac0c3f0d4` | `414ea288261d8185c02c607b8606664954b8bba86a5ae63d0a16201bef260c96` |
| `web/vf-ui/geom/vf-clustered-light-shading-oracle.mjs` | `020a1a4b454b076d7123b634e0611bfe44895bab` | `e80ad37e3c2fc2506e532751b18c6d6c6b15a63af8ea2ff0d2ea52afd5729dd2` |
| `tests/js/vf-geom-clustered-light-shader.test.mjs` | `bfe46725098adff5acca2870d5e5fc320e330206` | `910e5f74534fd85f019cf7fc61131d42317392e1fc2290560a2029eff85fc3d7` |
| `tests/js/vf-geom-clustered-light-wiring.test.mjs` | `0e1d586967eba2ba4ad77652fc0eba9a240fcdea` | `c5dea19ac1cf0e8a44f8155d1921489d02ed4dea47dda05a4fd3021fbeeac6d9` |
| `tests/fixtures/clustered_projected_aperture_capture.html` | `b742a48abfacc6303b45a0bf6b0304acdd249cc2` | `fee20457843b236d1d10404864692ab096e3c58d59aedc0768b3b91edbb4b62e` |
| `tests/helpers/capture_mirror_scene.js` | `17bb05d5df88b5d2dee424cecdfb0e4db4516658` | `cf48eb3661482b90f8981575cff6856dc951606a50d9a276913b81e5f8f8cdb1` |
| `tests/helpers/assert_projected_aperture_capture.ps1` | `081a5aad18e7816d5c260c0e243312737b555e3e` | `53a8e989ed20c9a7ddafa100e62c53a2af39542698446a7b4c72402b657fa13d` |
| `docs/evidence/artifacts/040-g01f-projected-aperture-offscreen.png` | `9b80dfa0683e83df8f0724d2f7ec2fae93a83f18` | `116a2c0dfc9022766f33e552ee93c3eb488e493c7727ac591735a5b6a8a30dac` |
