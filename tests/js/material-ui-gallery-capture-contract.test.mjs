import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("material gallery capture is off-screen, event-driven, and uses the VKF frame capture API", async () => {
  const [capture, builder] = await Promise.all([
    readFile(path.join(repositoryRoot, "tests/helpers/capture_material_ui_gallery.js"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/build-material-ui-gallery-media.mjs"), "utf8"),
  ]);
  assert.match(capture, /captureGeomFrameDataUrl/u);
  assert.match(capture, /\.click\(\)/u);
  for (const id of ["view-lighting", "view-mirror", "view-glass", "view-all"]) {
    assert.match(capture, new RegExp(id, "u"));
  }
  assert.doesNotMatch(capture, /--window-position/u);
  assert.match(builder, /VF_CAPTURE_OFFSCREEN_GPU:\s*"0"/u);
  assert.match(builder, /material-ui-gallery\.gif/u);
});
