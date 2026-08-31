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

function littleEndianU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

test("transparent overlay README capture remains tied to its executable sources", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schema, "vkf-media-freshness/1");
  assert.equal(manifest.capture.api, "VfDisplay.__test.captureGeomFrameDataUrl");
  assert.equal(manifest.capture.execution, "headless Edge WebGPU");

  for (const [relativePath, expected] of Object.entries(manifest.sources)) {
    assert.equal(sha256(await readFile(path.join(repoRoot, relativePath))), expected, relativePath);
  }

  for (const [relativePath, spec] of Object.entries(manifest.media)) {
    assert.equal(sha256(await readFile(path.join(repoRoot, relativePath))), spec.sha256, relativePath);
  }

  const pngSpec = manifest.media["docs/public/images/readme-ui/ui-transparent-overlay-offscreen.png"];
  const png = await readFile(path.join(repoRoot, "docs/public/images/readme-ui/ui-transparent-overlay-offscreen.png"));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), pngSpec.width);
  assert.equal(png.readUInt32BE(20), pngSpec.height);

  const gifSpec = manifest.media["docs/public/images/readme-ui/ui-transparent-overlay-offscreen.gif"];
  const gif = await readFile(path.join(repoRoot, "docs/public/images/readme-ui/ui-transparent-overlay-offscreen.gif"));
  assert.equal(gif.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(littleEndianU16(gif, 6), gifSpec.width);
  assert.equal(littleEndianU16(gif, 8), gifSpec.height);
  assert.notEqual(gif.indexOf(Buffer.from("NETSCAPE2.0", "ascii")), -1, "GIF must loop in README");
  let graphicControlBlocks = 0;
  for (let offset = 0; offset < gif.length - 3; offset += 1) {
    if (gif[offset] === 0x21 && gif[offset + 1] === 0xf9 && gif[offset + 2] === 0x04) {
      graphicControlBlocks += 1;
    }
  }
  assert.equal(graphicControlBlocks, gifSpec.frames);
});
