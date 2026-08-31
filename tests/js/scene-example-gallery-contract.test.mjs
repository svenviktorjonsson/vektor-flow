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

test("scene gallery captures a public mirrored surface", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "03-mirror");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "mirror", "reflection"]);
  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  assert.ok(source.includes("surface_system:"));
  assert.ok(source.includes("mirror_of:"));
  assert.ok(source.includes("reflectivity:"));
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
  assert.equal(example.capture.hidden, true);
});

test("scene gallery captures tinted glass through the public material fields", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "04-tinted-glass");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "transparency", "tinted-glass"]);
  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  for (const field of ["alpha:", "transparent:true", "depth_write:false", "reflectivity:"]) {
    assert.ok(source.includes(field), `missing ${field}`);
  }
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
});

test("scene gallery captures a procedural checker texture", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "05-checker-texture");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "texture", "checker"]);
  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  for (const field of ["texture:(", "kind:\"checker\"", "color_a:", "color_b:"]) {
    assert.ok(source.includes(field), `missing ${field}`);
  }
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
});

test("scene gallery captures a cast and received shadow", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "06-shadows");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "lighting", "shadows"]);
  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  assert.ok(source.includes("casts_shadow:true"));
  assert.ok(source.includes("receives_shadow:true"));
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
});

test("scene gallery captures warm and cool lights together", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "07-multiple-lights");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "lighting", "multiple-lights"]);
  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  assert.ok(source.match(/\.add_light\(/gu)?.length >= 2);
  assert.ok(source.includes('id:"warm"'));
  assert.ok(source.includes('id:"cool"'));
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
});

test("scene gallery captures the shader grass material", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "08-grass");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "texture", "grass"]);
  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  for (const field of ['kind:"grass"', "blade_length:", "clump_density:", "micro_shadow:"]) {
    assert.ok(source.includes(field), `missing ${field}`);
  }
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
});

test("scene gallery captures static HTML and CSS controls with VKF events", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "09-html-controls");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "html", "css", "events"]);
  const exampleRoot = path.join(galleryRoot, path.dirname(example.source));
  const [source, html, css] = await Promise.all([
    readFile(path.join(galleryRoot, example.source), "utf8"),
    readFile(path.join(exampleRoot, "ui/main.html"), "utf8"),
    readFile(path.join(exampleRoot, "ui/gallery.css"), "utf8"),
  ]);
  assert.ok(source.includes('.load("ui/main.html")'));
  assert.ok(source.includes(".events.get()"));
  assert.match(html, /<button\b/u);
  assert.match(html, /<input\b/u);
  assert.doesNotMatch(html, /<script\b/iu);
  assert.ok(css.length > 100);
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
});

test("scene gallery captures a focused sun reflection", async () => {
  const manifest = JSON.parse(await readFile(path.join(galleryRoot, "manifest.json"), "utf8"));
  const example = manifest.examples.find(({ id }) => id === "10-sun-reflection");
  assert.ok(example);
  assert.deepEqual(example.features, ["3d", "lighting", "specular", "sun-reflection"]);
  const source = await readFile(path.join(galleryRoot, example.source), "utf8");
  assert.ok(source.includes('id:"sun"'));
  assert.ok(source.includes('kind:"projected"'));
  assert.ok(source.includes('reflect_of_light_id:"sun"'));
  assert.ok(source.includes('reflect_mirror_mesh_id:"mirror"'));
  assert.ok(source.includes("specular_strength:1"));
  assert.ok(source.includes("roughness:0.02"));
  assert.equal(sha256(Buffer.from(source.replaceAll("\r\n", "\n"))), example.sourceSha256);
  const bytes = await readFile(path.join(repositoryRoot, example.media.path));
  assert.ok(bytes.length > 100);
  assert.equal(sha256(bytes), example.media.sha256);
});
