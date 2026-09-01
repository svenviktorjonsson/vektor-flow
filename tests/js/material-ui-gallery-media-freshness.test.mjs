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
    "view-lighting", "view-mirror", "view-glass", "view-all", "glass-alpha=0.72",
  ]);
  assert.equal(manifest.capture.composite_states.length, 5);
  assert.equal(new Set(manifest.capture.composite_states.map(({ sha256 }) => sha256)).size, 5);
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

  const gifSpec = manifest.media["docs/public/images/readme-ui/material-ui-gallery.gif"];
  const gif = await readFile(path.join(mediaRoot, "material-ui-gallery.gif"));
  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(gif.readUInt16LE(6), gifSpec.width);
  assert.equal(gif.readUInt16LE(8), gifSpec.height);
  assert.notEqual(gif.indexOf(Buffer.from("NETSCAPE2.0", "ascii")), -1);
  let frames = 0;
  for (let index = 0; index < gif.length - 3; index += 1) {
    if (gif[index] === 0x21 && gif[index + 1] === 0xf9 && gif[index + 2] === 0x04) frames += 1;
  }
  assert.equal(frames, gifSpec.frames);

  const rendererSpec = manifest.media["docs/public/images/readme-ui/material-ui-gallery-renderer.gif"];
  const renderer = await readFile(path.join(mediaRoot, "material-ui-gallery-renderer.gif"));
  assert.equal(renderer.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(renderer.readUInt16LE(6), rendererSpec.width);
  assert.equal(renderer.readUInt16LE(8), rendererSpec.height);
  assert.equal(rendererSpec.frames, 5);
  assert.notEqual(rendererSpec.sha256, gifSpec.sha256);
});
