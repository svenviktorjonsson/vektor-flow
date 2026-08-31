import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const galleryRoot = path.join(repositoryRoot, "examples", "scene_gallery");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("scene gallery starts with a minimal captured 2D line plot", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.schema, "vkf.scene-example-gallery/1");
  const example = manifest.examples.find(({ id }) => id === "01-line-plot");
  assert.ok(example);
  assert.equal(example.dimension, 2);
  assert.deepEqual(example.features, ["2d", "plot"]);

  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  assert.ok(source.includes("Display("));
  assert.ok(source.includes(".add(") || source.includes(".plot("));
  assert.ok(source.split(/\r?\n/u).filter((line) => line.trim()).length <= 20);
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);

  assert.match(example.media.path, /\.png$/u);
  const mediaPath = path.join(repositoryRoot, example.media.path);
  const bytes = await readFile(mediaPath);
  assert.ok((await stat(mediaPath)).size > 100);
  assert.equal(sha256(bytes), example.media.sha256);
  assert.equal(example.capture.hidden, true);
  assert.equal(example.capture.applicationJavaScript, false);
});

test("scene gallery captures a minimal illuminated 3D surface", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "02-lit-surface");
  assert.ok(example);
  assert.equal(example.dimension, 3);
  assert.deepEqual(example.features, ["3d", "surface", "lighting"]);

  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  assert.ok(source.includes(".add_camera("));
  assert.ok(source.includes(".add_light("));
  assert.ok(source.includes(".add("));
  assert.ok(source.split(/\r?\n/u).filter((line) => line.trim()).length <= 20);
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);

  const mediaPath = path.join(repositoryRoot, example.media.path);
  const bytes = await readFile(mediaPath);
  assert.ok((await stat(mediaPath)).size > 100);
  assert.equal(sha256(bytes), example.media.sha256);
  assert.equal(example.capture.hidden, true);
});
