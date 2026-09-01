import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const sourcePath = "examples/material_ui_gallery/app.vkf";
const source = readFileSync(resolve(root, sourcePath), "utf8");
const bunnyPath = "examples/material_ui_gallery/assets/source/bun_zipper.ply";
const bunny = readFileSync(resolve(root, bunnyPath));
const provenance = readFileSync(
  resolve(root, "examples/material_ui_gallery/assets/source/ASSET_SOURCE.md"),
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

test("material gallery loads the canonical full Stanford Bunny", () => {
  const text = bunny.toString("utf8");
  assert.match(text, /^ply\r?\nformat ascii 1\.0\r?\n/u);
  assert.match(text, /^element vertex 35947$/mu);
  assert.match(text, /^element face 69451$/mu);
  assert.equal(createHash("sha256").update(bunny).digest("hex"),
    "b1acc63bece78444aa2e15bdcc72371a201279b98c6f5d4b74c993d02f0566fe");
  assert.match(provenance, /Stanford Computer Graphics Laboratory/u);
  assert.match(provenance, /noncommercial restriction/u);
  assert.match(source, /bunny:\s*load\("assets\/source\/bun_zipper\.ply"\)/u);
  assert.match(source, /vertices:\s*bunny\.vertices/u);
  assert.match(source, /indices:\s*bunny\.faces/u);
  assert.doesNotMatch(source, /rabbit_(body|head|ear|tail)|frame\.add\(/u);
});

test("Stanford Bunny studio has checker continuity, physical mirrors, and shadow", () => {
  assert.match(source, /id:"stanford_bunny"[\s\S]*?topology:"triangle-list"/u);
  assert.match(source, /id:"stanford_bunny"[\s\S]*?interpolation:true/u);
  assert.match(source, /id:"stanford_bunny"[\s\S]*?casts_shadow:true/u);
  assert.match(source,
    /id:"studio_floor"[\s\S]*?texture:\(kind:"checker"[\s\S]*?mesh_id:"studio_floor"/u);
  assert.match(source,
    /id:"studio_floor", center:\[0\.0, 3\.25, 0\.0\], size:\[7\.4, 14\.0\]/u);
  assert.match(source,
    /id:"studio_floor"[\s\S]*?texture:\(kind:"checker", scale:\[8\.0, 16\.0\]/u);
  assert.match(source, /id:"upright_mirror"[\s\S]*?mesh_id:"upright_mirror"/u);
  assert.match(source,
    /id:"upright_mirror"[\s\S]*?alpha:1\.0, reflectivity:1\.0, roughness:0\.01/u);
  assert.match(source,
    /id:"upright_mirror"[\s\S]*?surface_system:\(kind:"screen", reflectivity:1\.0/u);
  const uprightMirror = source.match(
    /id:"upright_mirror"[\s\S]*?casts_shadow:true/u,
  )?.[0] ?? "";
  assert.match(uprightMirror, /flip_y:true/u);
  assert.doesNotMatch(uprightMirror, /flip_x:true/u,
    "the physical mirror camera already reverses X; a texture flip would undo it");
  assert.doesNotMatch(source, /transparent:true/u);
  assert.equal(source.match(/kind:"checker"/gu)?.length, 1,
    "the studio has one checkerboard material, not overlapping floors");
  assert.doesNotMatch(source, /\bplane:\(/u);
  assert.match(source,
    /id:"sun_key", kind:"point", pos:\[-5\.2, 0\.3, 7\.4\]/u,
    "the high key stays laterally outside the mirror so its rear edge is visible");
  assert.match(source, /id:"sun_key"[\s\S]*?intensity:58\.0[\s\S]*?casts_shadow:true/u);
  assert.match(source, /id:"sky_fill"[\s\S]*?intensity:6\.0[\s\S]*?casts_shadow:false/u,
    "fill light must not wash out the Bunny shadow");
  assert.match(source, /id:"mirror_sun"[\s\S]*?intensity:92\.0/u,
    "the mirror-projected sunlight must remain visible over direct illumination");
  assert.match(source,
    /id:"mirror_sun"[\s\S]*?reflect_of_light_id:"sun_key"[\s\S]*?reflect_mirror_mesh_id:"upright_mirror"/u);
  assert.match(source,
    /receiver_mesh:"studio_floor"[\s\S]*?occluders:\["stanford_bunny", "upright_mirror"\]/u);
  assert.match(source, /title:"Stanford Bunny material studio"/u);
});

test("rabbit gallery source remains linked to hidden capture evidence", () => {
  assert.equal(manifest.capture.fixture, sourcePath);
  assert.equal(manifest.capture.execution, "headless Edge WebGPU");
  assert.equal(manifest.capture.api, "VfDisplay.__test.captureGeomFrameDataUrl");
  assert.equal(manifest.capture.composite_api, "Page.captureScreenshot");
  assert.equal(manifest.sources[sourcePath], canonicalHash(source));
  for (const linkedSource of [
    sourcePath,
    bunnyPath,
    "examples/material_ui_gallery/assets/source/ASSET_SOURCE.md",
    "tests/helpers/capture_material_ui_gallery.js",
    "web/vf-ui/vf-display.js",
    "web/vf-ui/geom/vf-geom-wgpu.js",
  ]) {
    assert.ok(manifest.sources[linkedSource], `${linkedSource} is not hash-linked`);
    assert.ok(builder.includes(`"${linkedSource}"`), `${linkedSource} is not in the capture builder`);
  }
  assert.ok(readme.indexOf(`(${sourcePath})`) < readme.indexOf("material-ui-gallery.webp"));
});
