import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const manifest = JSON.parse(readFileSync(
  resolve(root, "examples", "scene_gallery", "manifest.json"),
  "utf8",
));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const namedFrames = new Map([
  ["10-sun-reflection", "solkatt_frame"],
  ["11-roughness", "roughness_frame"],
  ["12-layered-glass", "layered_frame"],
  ["15-spot-light", "spot_frame"],
  ["16-dice-texture", "dice_frame"],
  ["17-world-embedding", "world_0_view_0"],
  ["19-wireframe-points", "wireframe_points"],
  ["20-rigid-body-snapshot", "rigid_snapshot"],
]);

test("retired README scene gallery assets remain complete and hash locked", () => {
  assert.equal(manifest.examples.length, 20);

  for (const example of manifest.examples) {
    const source = readFileSync(resolve(
      root,
      "examples",
      "scene_gallery",
      example.source,
    ), "utf8").replaceAll("\r\n", "\n");
    const media = readFileSync(resolve(root, example.media.path));

    assert.ok(source.trim().length > 0, `${example.id} source is empty`);
    assert.equal(
      sha256(source),
      example.sourceSha256,
      `${example.id} source digest is stale`,
    );
    assert.equal(
      sha256(media),
      example.media.sha256,
      `${example.id} media digest is stale`,
    );
  }
});

test("retired scene captures retain their provenance contract", () => {
  for (const example of manifest.examples) {
    assert.equal(example.capture.hidden, true, `${example.id} is not hidden`);
    assert.equal(
      example.capture.applicationJavaScript,
      false,
      `${example.id} uses application JavaScript`,
    );
    assert.equal(example.capture.api, "Page.captureScreenshot");
    assert.equal(
      example.capture.frame,
      namedFrames.get(example.id) ?? "frame_0",
      `${example.id} capture frame changed`,
    );
  }
});
