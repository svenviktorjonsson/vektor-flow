import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("material gallery capture is off-screen, camera-driven, and uses the VKF frame capture API", async () => {
  const [capture, builder, encoder, animationBuilder, adapter, host, launcher] = await Promise.all([
    readFile(path.join(repositoryRoot, "tests/helpers/capture_native_frame.js"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/build-material-ui-gallery-media.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "tools/encode_native_frame_capture.py"), "utf8"),
    readFile(path.join(repositoryRoot, "tools/build_material_ui_gallery_webp.py"), "utf8"),
    readFile(path.join(repositoryRoot, "web/vf-ui/vf-compiled-webgpu-adapter.js"), "utf8"),
    readFile(path.join(repositoryRoot, "native/VfOverlay/vf/release_overlay_host.cpp"), "utf8"),
    readFile(path.join(repositoryRoot, "native/VfOverlay/vkf_launcher.cpp"), "utf8"),
  ]);
  assert.match(builder, /VKF_NATIVE_FRAME_CAPTURE_PATH/u);
  assert.match(capture, /vf_native_frame_media_capture_v1/u);
  assert.match(capture, /rgba_base64/u);
  assert.match(builder, /windowsHide:\s*true/u);
  assert.doesNotMatch(capture, /Edge|CDP|Page\.captureScreenshot|captureGeomFrameDataUrl/u);
  assert.match(builder, /vkf_wasm_artifact_smoke/u);
  assert.match(builder, /vkf_webgpu_artifact_smoke/u);
  assert.match(builder, /vkf-ui-package/u);
  assert.match(builder, /capture_native_frame\.js/u);
  assert.match(builder, /encode_native_frame_capture\.py/u);
  assert.match(encoder, /Image\.frombytes\("RGBA"/u);
  assert.match(encoder, /rgba_base64/u);
  assert.match(builder, /material-ui-gallery\.webp/u);
  assert.match(builder, /bun_zipper\.ply/u);
  assert.doesNotMatch(builder, /Edge|Page\.captureScreenshot|captureGeomFrameDataUrl/u);
  assert.match(animationBuilder, /lossless=True/u);
  assert.match(adapter, /raw\.mode === "time"/u);
  assert.match(adapter, /wasm\.update\(\)/u);
  assert.match(adapter, /orbit-degree-/u);
  assert.match(adapter, /vf_native_frame_media_capture_frame_v1/u,
    "movie frames must stream to the native host instead of collecting in browser memory");
  assert.match(host, /VKF_NATIVE_FRAME_CAPTURE_TIME_SAMPLES/u);
  assert.match(host, /VKF_NATIVE_FRAME_CAPTURE_WIDTH/u);
  assert.match(host, /VKF_NATIVE_FRAME_CAPTURE_HEIGHT/u);
  assert.match(host, /vf_native_frame_media_capture_frame_v1/u);
  assert.match(host, /g_prewarm_probe && !g_native_frame_capture/u,
    "a complete movie capture must not be cut off by the idle prewarm TTL");
  assert.match(launcher,
    /VKF_NATIVE_FRAME_CAPTURE_PATH[\s\S]*?LaunchProcess\(target, L"", target\.parent_path\(\), false\)/u,
    "native capture must launch normally instead of borrowing the bounded prewarm process");
  assert.match(encoder, /orbit-degree-/u);
});
