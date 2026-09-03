import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8")
  .replaceAll("\r\n", "\n");
const manifest = JSON.parse(readFileSync(
  resolve(root, "examples", "scene_gallery", "manifest.json"),
  "utf8",
));

test("README presents every scene source before its linked media", () => {
  assert.match(readme, /## Scene example gallery/);
  assert.equal(manifest.examples.length, 20);

  for (const example of manifest.examples) {
    const sourcePath = `examples/scene_gallery/${example.source}`;
    const source = readFileSync(resolve(root, sourcePath), "utf8")
      .replaceAll("\r\n", "\n")
      .trimEnd();
    const start = `<!-- scene-example:${example.id}:start -->`;
    const end = `<!-- scene-example:${example.id}:end -->`;
    const card = readme.slice(
      readme.indexOf(start),
      readme.indexOf(end) + end.length,
    );

    assert.ok(card.startsWith(start), `${example.id} is missing its README card`);
    assert.doesNotMatch(card, /<table>/, `${example.id} still uses a table`);
    assert.ok(
      card.includes(`[${example.title}](${sourcePath})`),
      `${example.id} does not link its source`,
    );
    assert.ok(
      card.includes(`](${example.media.path})`),
      `${example.id} does not link its capture`,
    );
    assert.ok(
      card.includes(`![${example.title} full-compositor capture](${example.media.path})`),
      `${example.id} does not display its capture`,
    );
    assert.ok(
      card.includes(`\`\`\`vkf\n${source}\n\`\`\``),
      `${example.id} does not show its current complete source`,
    );
    assert.ok(
      card.indexOf(`[${example.title}](${sourcePath})`)
        < card.indexOf("```vkf")
        && card.indexOf("```vkf")
          < card.indexOf(`![${example.title} full-compositor capture]`),
      `${example.id} does not put its capture after its source`,
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
