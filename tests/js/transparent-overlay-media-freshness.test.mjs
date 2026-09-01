import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = path.join(
  repoRoot,
  "docs",
  "public",
  "images",
  "readme-ui",
  "ui-transparent-overlay-offscreen.manifest.json",
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256CanonicalText(bytes) {
  return sha256(Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")));
}

function littleEndianU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function gifFrameCount(bytes) {
  let offset = 13;
  if ((bytes[10] & 0x80) !== 0) {
    offset += 3 * (2 ** ((bytes[10] & 0x07) + 1));
  }
  let frames = 0;
  const skipSubBlocks = () => {
    while (offset < bytes.length) {
      const length = bytes[offset];
      offset += 1;
      if (length === 0) break;
      offset += length;
    }
  };
  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset += 1;
      skipSubBlocks();
      continue;
    }
    assert.equal(marker, 0x2c, `unexpected GIF block 0x${marker.toString(16)}`);
    frames += 1;
    const packed = bytes[offset + 8];
    offset += 9;
    if ((packed & 0x80) !== 0) {
      offset += 3 * (2 ** ((packed & 0x07) + 1));
    }
    offset += 1;
    skipSubBlocks();
  }
  return frames;
}

test("transparent overlay README capture remains tied to its executable sources", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schema, "vkf-media-freshness/1");
  assert.equal(manifest.capture.api, "VfDisplay.__test.captureGeomFrameDataUrl");
  assert.equal(manifest.capture.composite_api, "Page.captureScreenshot");
  assert.equal(manifest.capture.execution, "headless Edge WebGPU");
  assert.equal(manifest.capture.fixture, "examples/material_ui_gallery/app.vkf");
  assert.equal(manifest.capture.pairs.length, 2);
  for (const pair of manifest.capture.pairs) {
    assert.match(pair.renderer_sha256, /^[a-f0-9]{64}$/u);
    assert.match(pair.composite_sha256, /^[a-f0-9]{64}$/u);
    assert.notEqual(pair.renderer_sha256, pair.composite_sha256);
    assert.equal(pair.static_html, true);
    assert.equal(pair.frame_chrome, true);
    assert.equal(pair.webgpu_canvas, true);
  }

  for (const [relativePath, expected] of Object.entries(manifest.sources)) {
    assert.equal(
      sha256CanonicalText(await readFile(path.join(repoRoot, relativePath))),
      expected,
      relativePath,
    );
  }

  for (const [relativePath, spec] of Object.entries(manifest.media)) {
    assert.equal(sha256(await readFile(path.join(repoRoot, relativePath))), spec.sha256, relativePath);
  }

  const pngSpec = manifest.media["docs/public/images/readme-ui/ui-transparent-overlay-offscreen.png"];
  const png = await readFile(path.join(repoRoot, "docs/public/images/readme-ui/ui-transparent-overlay-offscreen.png"));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), pngSpec.width);
  assert.equal(png.readUInt32BE(20), pngSpec.height);

  const rendererPngSpec = manifest.media[
    "docs/public/images/readme-ui/ui-transparent-overlay-offscreen-renderer.png"
  ];
  const rendererPng = await readFile(path.join(
    repoRoot, "docs/public/images/readme-ui/ui-transparent-overlay-offscreen-renderer.png",
  ));
  assert.deepEqual([...rendererPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(rendererPng.readUInt32BE(16), rendererPngSpec.width);
  assert.equal(rendererPng.readUInt32BE(20), rendererPngSpec.height);
  assert.notEqual(rendererPngSpec.sha256, pngSpec.sha256);

  const gifSpec = manifest.media["docs/public/images/readme-ui/ui-transparent-overlay-offscreen.gif"];
  const gif = await readFile(path.join(repoRoot, "docs/public/images/readme-ui/ui-transparent-overlay-offscreen.gif"));
  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(littleEndianU16(gif, 6), gifSpec.width);
  assert.equal(littleEndianU16(gif, 8), gifSpec.height);
  assert.notEqual(gif.indexOf(Buffer.from("NETSCAPE2.0", "ascii")), -1, "GIF must loop in README");
  assert.equal(gifFrameCount(gif), gifSpec.frames);

  const rendererGifSpec = manifest.media[
    "docs/public/images/readme-ui/ui-transparent-overlay-offscreen-renderer.gif"
  ];
  const rendererGif = await readFile(path.join(
    repoRoot, "docs/public/images/readme-ui/ui-transparent-overlay-offscreen-renderer.gif",
  ));
  assert.equal(rendererGif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(littleEndianU16(rendererGif, 6), rendererGifSpec.width);
  assert.equal(littleEndianU16(rendererGif, 8), rendererGifSpec.height);
  assert.equal(rendererGifSpec.frames, manifest.capture.pairs.length);
  assert.notEqual(rendererGifSpec.sha256, gifSpec.sha256);
});
