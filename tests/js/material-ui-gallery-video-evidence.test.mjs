import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const relativeVideo = "docs/public/videos/stanford-bunny-rotating-lights-360.mp4";
const relativeSource = "examples/material_ui_gallery/app.vkf";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("published rabbit orbit is one complete 360-sample repeat cycle", async () => {
  const [manifest, video, source] = await Promise.all([
    readFile(path.join(
      repositoryRoot,
      "docs/public/videos/stanford-bunny-rotating-lights-360.manifest.json",
    ), "utf8").then(JSON.parse),
    readFile(path.join(repositoryRoot, relativeVideo)),
    readFile(path.join(repositoryRoot, relativeSource)),
  ]);

  assert.equal(manifest.schema, "vektor-flow/video-evidence-v1");
  assert.equal(manifest.video, relativeVideo);
  assert.equal(manifest.source, relativeSource);
  assert.equal(manifest.source_sha256, sha256(source));
  assert.equal(manifest.sha256, sha256(video));
  assert.equal(manifest.bytes, video.byteLength);
  assert.deepEqual(
    {
      samples: manifest.capture.samples,
      first: manifest.capture.first_degree,
      last: manifest.capture.last_degree,
      playback: manifest.capture.playback,
      errors: manifest.capture.vkf_error_count,
    },
    { samples: 360, first: 0, last: 359, playback: "repeat", errors: 0 },
  );
  assert.notEqual(
    manifest.capture.first_frame_checksum,
    manifest.capture.last_frame_checksum,
    "359 degrees must be distinct from 0 degrees; repeat performs the next wrap",
  );
  assert.deepEqual(
    {
      codec: manifest.encoding.codec,
      fps: manifest.encoding.fps,
      frames: manifest.encoding.frames,
      duration: manifest.encoding.duration_seconds,
    },
    { codec: "H.264", fps: 30, frames: 360, duration: 12 },
  );
});
