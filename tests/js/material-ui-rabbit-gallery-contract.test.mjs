import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const sourcePath = "examples/material_ui_gallery/app.vkf";
const source = readFileSync(resolve(root, sourcePath), "utf8");
const html = readFileSync(
  resolve(root, "examples/material_ui_gallery/ui/main.html"),
  "utf8",
);
const builder = readFileSync(
  resolve(root, "scripts/build-material-ui-gallery-media.mjs"),
  "utf8",
);
const manifest = JSON.parse(readFileSync(
  resolve(root, "docs/public/images/readme-ui/material-ui-gallery.manifest.json"),
  "utf8",
));
const readme = readFileSync(resolve(root, "README.md"), "utf8");

function calls(name) {
  const result = [];
  let cursor = 0;
  while ((cursor = source.indexOf(`${name}(`, cursor)) !== -1) {
    const start = cursor;
    cursor += name.length;
    let depth = 0;
    let quoted = false;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === '"' && source[cursor - 1] !== "\\") quoted = !quoted;
      if (quoted) continue;
      if (character === "(") depth += 1;
      if (character !== ")") continue;
      depth -= 1;
      if (depth === 0) {
        result.push(source.slice(start, cursor + 1));
        cursor += 1;
        break;
      }
    }
  }
  return result;
}

function idOf(call) {
  return call.match(/\bid\s*:\s*"([^"]+)"/u)?.[1];
}

function canonicalHash(text) {
  return createHash("sha256")
    .update(Buffer.from(text.replaceAll("\r\n", "\n")))
    .digest("hex");
}

test("material gallery authors a recognizable rabbit mirror studio", () => {
  const surfaces = new Map(calls("frame.add").map((call) => [idOf(call), call]));
  const rabbitParts = [
    "rabbit_body",
    "rabbit_head",
    "rabbit_ear_left",
    "rabbit_ear_right",
    "rabbit_tail",
  ];
  assert.deepEqual(
    rabbitParts.filter((id) => !surfaces.has(id)),
    [],
    "rabbit silhouette must have body, head, two ears, and tail",
  );
  for (const id of rabbitParts) {
    const part = surfaces.get(id);
    for (const field of ["x:", "y:", "z:", "casts_shadow:true", "receives_lighting:true"]) {
      assert.ok(part.includes(field), `${id} is missing ${field}`);
    }
  }
  assert.equal(surfaces.has("sculpture_panel"), false);
  assert.equal(surfaces.has("glass_panel"), false);

  const floor = surfaces.get("studio_floor");
  assert.ok(floor, "checker/mirror floor is missing");
  assert.match(floor, /texture:\s*\([\s\S]*?kind:\s*"checker"/u);
  assert.match(floor, /surface_system:\s*\([\s\S]*?kind:\s*"screen"/u);
  assert.match(floor, /mirror_of:\s*\([\s\S]*?mesh_id:\s*"studio_floor"/u);

  const mirror = surfaces.get("upright_mirror");
  assert.ok(mirror, "upright mirror is missing");
  assert.match(mirror, /surface_system:\s*\([\s\S]*?kind:\s*"screen"/u);
  assert.match(mirror, /mirror_of:\s*\([\s\S]*?mesh_id:\s*"upright_mirror"/u);

  const strongLights = calls("frame.add_light").filter((call) => {
    const intensity = Number(call.match(/\bintensity\s*:\s*([0-9.]+)/u)?.[1]);
    return intensity >= 48 && /\bcasts_shadow\s*:\s*true/u.test(call);
  });
  assert.ok(strongLights.length >= 1, "studio needs a shadow-casting light at intensity >= 48");
  assert.match(html, /rabbit/iu);
});

test("rabbit gallery source remains linked to hidden capture evidence", () => {
  assert.equal(manifest.capture.fixture, sourcePath);
  assert.equal(manifest.capture.execution, "headless Edge WebGPU");
  assert.equal(manifest.capture.api, "VfDisplay.__test.captureGeomFrameDataUrl");
  assert.equal(manifest.capture.composite_api, "Page.captureScreenshot");
  assert.equal(manifest.sources[sourcePath], canonicalHash(source));
  for (const linkedSource of [
    sourcePath,
    "examples/material_ui_gallery/ui/main.html",
    "examples/material_ui_gallery/ui/gallery.css",
    "tests/helpers/capture_material_ui_gallery.js",
  ]) {
    assert.ok(manifest.sources[linkedSource], `${linkedSource} is not hash-linked`);
    assert.ok(builder.includes(`"${linkedSource}"`), `${linkedSource} is not in the capture builder`);
  }
  assert.ok(readme.indexOf(`(${sourcePath})`) < readme.indexOf("material-ui-gallery.gif"));
});
