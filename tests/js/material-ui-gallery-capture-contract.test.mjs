import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("material gallery capture is off-screen, camera-driven, and uses the VKF frame capture API", async () => {
  const [capture, builder, animationBuilder] = await Promise.all([
    readFile(path.join(repositoryRoot, "tests/helpers/capture_material_ui_gallery.js"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/build-material-ui-gallery-media.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "tools/build_material_ui_gallery_webp.py"), "utf8"),
  ]);
  assert.match(capture, /captureGeomFrameDataUrl/u);
  assert.match(capture, /Page\.captureScreenshot/u);
  assert.match(capture, /compositeSha256/u);
  assert.match(capture, /staticHtml/u);
  assert.match(capture, /frameChrome/u);
  assert.match(capture, /webgpuCanvas/u);
  assert.match(capture, /WheelEvent/u);
  assert.match(capture, /stanford-bunny-detail/u);
  assert.match(capture, /material_gallery_frame/u);
  assert.match(capture, /meshCount !== 5/u);
  assert.match(capture, /analyzeSurfaceTextures/u);
  assert.match(capture, /_debugReadSurfaceTexture/u);
  assert.match(capture, /warmPixels/u);
  assert.match(capture, /for \(const threshold of \[50, 90, 130\]\)/u);
  assert.match(capture, /threshold === 130/u);
  assert.match(capture, /"studio_floor", "upright_mirror"/u);
  assert.doesNotMatch(capture, /--window-position/u);
  assert.match(builder, /VF_CAPTURE_OFFSCREEN_GPU:\s*"0"/u);
  assert.match(builder, /material-ui-gallery\.webp/u);
  assert.match(builder, /material-ui-gallery-renderer\.webp/u);
  assert.match(builder, /bun_zipper\.ply/u);
  assert.doesNotMatch(builder, /material-ui-gallery(?:-renderer)?\.gif/u);
  assert.match(animationBuilder, /lossless=True/u);
});
