import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const manifest = JSON.parse(readFileSync(
  resolve(root, "examples", "scene_gallery", "manifest.json"),
  "utf8",
));

function escapeHtml(source) {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

test("README presents every scene example as linked source beside linked media", () => {
  assert.match(readme, /## Scene example gallery/);
  assert.equal(manifest.examples.length, 20);

  for (const example of manifest.examples) {
    const sourcePath = `examples/scene_gallery/${example.source}`;
    const source = readFileSync(resolve(root, sourcePath), "utf8").trimEnd();
    const start = `<!-- scene-example:${example.id}:start -->`;
    const end = `<!-- scene-example:${example.id}:end -->`;
    const card = readme.slice(
      readme.indexOf(start),
      readme.indexOf(end) + end.length,
    );

    assert.ok(card.startsWith(start), `${example.id} is missing its README card`);
    assert.match(card, /<table>/, `${example.id} is not laid out side-by-side`);
    assert.match(card, /<td width="55%" valign="top">/);
    assert.match(card, /<td width="45%" valign="top">/);
    assert.ok(
      card.includes(`<a href="${sourcePath}">`),
      `${example.id} does not link its source`,
    );
    assert.ok(
      card.includes(`<a href="${example.media.path}">`),
      `${example.id} does not link its capture`,
    );
    assert.ok(
      card.includes(`<img src="${example.media.path}"`),
      `${example.id} does not display its capture`,
    );
    assert.ok(
      card.includes(`<pre><code class="language-vkf">${escapeHtml(source)}</code></pre>`),
      `${example.id} does not show its current complete source`,
    );
  }
});

test("README describes the scene images as hidden full-compositor captures", () => {
  const section = readme.slice(
    readme.indexOf("## Scene example gallery"),
    readme.indexOf("## Install VKF"),
  );

  assert.match(section, /hidden Edge/);
  assert.match(section, /`Page\.captureScreenshot`/);
  assert.match(section, /full composited viewport/);
  assert.match(section, /frame chrome/);
  assert.match(section, /WebGPU canvas/);
  assert.match(section, /no application JavaScript/);
});
