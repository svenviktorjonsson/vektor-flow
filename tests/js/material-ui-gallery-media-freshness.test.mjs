import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const mediaRoot = path.join(repositoryRoot, "docs/public/images/readme-ui");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalTextHash(bytes) {
  return sha256(Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")));
}

test("material UI gallery media stays tied to executable VKF and capture sources", async () => {
  const manifest = JSON.parse(await readFile(
    path.join(mediaRoot, "material-ui-gallery.manifest.json"), "utf8",
  ));
  assert.equal(manifest.schema, "vkf-media-freshness/1");
  assert.equal(manifest.capture.api, "VfDisplay.__test.captureGeomFrameDataUrl");
  assert.equal(manifest.capture.composite_api, "Page.captureScreenshot");
  assert.equal(manifest.capture.execution, "headless Edge WebGPU");
  assert.deepEqual(manifest.capture.interactions, [
    "camera-default", "camera-wheel-detail",
  ]);
  assert.equal(manifest.capture.composite_states.length, 2);
  assert.equal(new Set(manifest.capture.composite_states.map(({ sha256 }) => sha256)).size, 2);
  for (const state of manifest.capture.composite_states) {
    assert.equal(state.static_html, true);
    assert.equal(state.frame_chrome, true);
    assert.equal(state.webgpu_canvas, true);
  }

  for (const [relativePath, expected] of Object.entries(manifest.sources)) {
    assert.equal(canonicalTextHash(await readFile(path.join(repositoryRoot, relativePath))), expected, relativePath);
  }
  for (const [relativePath, spec] of Object.entries(manifest.media)) {
    assert.equal(sha256(await readFile(path.join(repositoryRoot, relativePath))), spec.sha256, relativePath);
  }

  const pngSpec = manifest.media["docs/public/images/readme-ui/material-ui-gallery.png"];
  const png = await readFile(path.join(mediaRoot, "material-ui-gallery.png"));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), pngSpec.width);
  assert.equal(png.readUInt32BE(20), pngSpec.height);

  const webpPath = "docs/public/images/readme-ui/material-ui-gallery.webp";
  const webpSpec = manifest.media[webpPath];
  const webp = await readFile(path.join(mediaRoot, "material-ui-gallery.webp"));
  assert.equal(webp.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
  assert.notEqual(webp.indexOf(Buffer.from("ANIM", "ascii")), -1);
  assert.notEqual(webp.indexOf(Buffer.from("VP8L", "ascii")), -1);
  assert.equal(webp.indexOf(Buffer.from("VP8 ", "ascii")), -1);
  assert.equal(webp.toString("latin1").split("ANMF").length - 1, webpSpec.frames);

  const rendererPath = "docs/public/images/readme-ui/material-ui-gallery-renderer.webp";
  const rendererSpec = manifest.media[rendererPath];
  const renderer = await readFile(path.join(mediaRoot, "material-ui-gallery-renderer.webp"));
  assert.equal(renderer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(renderer.subarray(8, 12).toString("ascii"), "WEBP");
  assert.notEqual(renderer.indexOf(Buffer.from("ANIM", "ascii")), -1);
  assert.notEqual(renderer.indexOf(Buffer.from("VP8L", "ascii")), -1);
  assert.equal(renderer.indexOf(Buffer.from("VP8 ", "ascii")), -1);
  assert.equal(rendererSpec.frames, 2);
  assert.equal(renderer.toString("latin1").split("ANMF").length - 1, rendererSpec.frames);
  assert.notEqual(rendererSpec.sha256, webpSpec.sha256);
});
