# 0.4.1 compiled launch-manifest closure

Status: structurally green; hardware timing is deferred while the interactive
rabbit application is open.

## Removed cold-start dependency

The retained compiled rabbit previously fetched and decoded
`vf-launch-manifest.json` before it could mount the application frame. The
baseline manifest is 192 bytes and one browser subresource request. Its result
is already deterministic compiler output derived from the scene configuration.

The stager now emits that same launch manifest in `vkf-scene.html`. Compiled
scenes load the existing frame CSS and frame runtime, then mount the in-page
manifest directly. This removes one request and one JSON decode from the
launch-frame critical chain without adding runtime code or changing the public
VKF API.

## Exact fallback

The stager continues to write `vf-launch-manifest.json`. If an older shell does
not expose inline frame mounting, the generated bootstrap uses the existing
`mountLaunchFramesFromUrl` path. The focused test parses both manifests and
requires deep equality, so fallback layout, title, visibility, and frame ID
cannot diverge.

## Structural evidence

```powershell
$env:VKF_NATIVE_SCENE_STAGER = ".w/runtime-bundle-bin/vkf_native_scene_artifact_stager.exe"
node --test tests/compiler/compiled-scene-inline-launch-manifest.test.mjs
```

Result: 1/1 passed. The generated compiled page contains the inline manifest,
loads frame dependencies before mounting it, has no unconditional launch-file
fetch, and retains the external fallback.
