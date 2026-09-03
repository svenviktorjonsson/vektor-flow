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
const uiMarkup = readFileSync(
  resolve(root, "examples/material_ui_gallery/ui/main.html"),
  "utf8",
);
const uiStyles = readFileSync(
  resolve(root, "examples/material_ui_gallery/ui/gallery.css"),
  "utf8",
);
const provenance = readFileSync(
  resolve(root, "examples/material_ui_gallery/assets/source/ASSET_SOURCE.md"),
  "utf8",
);
const manifest = JSON.parse(readFileSync(
  resolve(root, "docs/public/videos/stanford-bunny-rotating-lights-360.manifest.json"),
  "utf8",
));

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

function numericArrayBinding(name) {
  const binding = source.indexOf(`\n${name}:`);
  assert.notEqual(binding, -1, `missing ${name} binding`);
  const start = source.indexOf("[", binding);
  assert.notEqual(start, -1, `missing ${name} array`);
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    if (source[cursor] === "[") depth += 1;
    if (source[cursor] !== "]") continue;
    depth -= 1;
    if (depth === 0) return JSON.parse(source.slice(start, cursor + 1));
  }
  assert.fail(`unterminated ${name} array`);
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
  assert.match(source, /p_uc:\s*bunny\.vertices/u);
  assert.match(source, /faces_uvw:\s*bunny\.faces/u);
  assert.doesNotMatch(source, /rabbit_(body|head|ear|tail)|native_scene/u);
});

test("Stanford Bunny studio has checker continuity, physical mirrors, and shadow", () => {
  const additions = calls("frame.add");
  const floor = additions.find((call) => idOf(call) === "studio_floor") ?? "";
  const mirror = additions.find((call) => idOf(call) === "upright_mirror") ?? "";
  const bunnyModel = additions.find((call) => idOf(call) === "stanford_bunny") ?? "";
  const red = additions.find((call) => idOf(call) === "red_emitter") ?? "";
  const green = additions.find((call) => idOf(call) === "green_emitter") ?? "";

  assert.match(bunnyModel, /p_uc:bunny\.vertices/u);
  assert.match(bunnyModel, /faces_uvw:bunny\.faces/u);
  assert.match(bunnyModel, /interpolation:true/u);
  assert.match(bunnyModel, /casts_shadow:true/u);
  assert.match(bunnyModel, /color:\[0\.98, 0\.98, 0\.98, 1\.0\]/u,
    "the agreed studio subject is a white Stanford Bunny");
  assert.match(bunnyModel, /receives_shadow:true/u,
    "the Bunny must retain modeled self-shadow gradients");
  assert.match(floor, /texture:\(\s*kind:"checker"/u);
  assert.match(floor, /reflectivity:0\.18/u);
  assert.doesNotMatch(floor, /surface_system|kind:"mirror"/u,
    "the floor must be distinguished only by reflectivity");
  assert.match(floor, /x:\[\[-0\.24, 0\.24\], \[-0\.24, 0\.24\]\]/u);
  assert.match(
    floor,
    /z:\[\[0\.42, 0\.42\], \[-0\.18, -0\.18\]\]/u,
    "the floor must face the camera so its authored reflection is visible",
  );
  assert.match(floor, /scale:\[16\.0, 20\.0\]/u);
  assert.match(mirror,
    /faces_uvw:\[\[0, 2, 1\], \[0, 3, 2\], \[0, 4, 3\], \[0, 5, 4\]\]/u,
    "the visible studio mirror must be a six-edge polygon rather than a rectangle");
  assert.match(mirror, /color:\[0\.34, 0\.34, 0\.34, 1\.0\]/u,
    "the non-reflective back uses an authored neutral medium-gray rough material");
  assert.match(mirror, /reflectivity:1\.0/u);
  assert.match(mirror, /roughness:0\.72/u);
  assert.match(mirror, /casts_shadow:true/u);
  assert.match(mirror, /receives_shadow:false/u,
    "a fully reflective screen must not run a redundant material shadow path");
  assert.doesNotMatch(mirror, /surface_system|kind:"mirror"/u,
    "the planar hex must be inferred from geometry and reflectivity");
  assert.doesNotMatch(mirror, /flip_[xy]:/u,
    "the reflected camera owns parity; material texture flips would undo it");
  assert.doesNotMatch(source, /transparent:true/u);
  assert.equal(source.match(/kind:"checker"/gu)?.length, 1,
    "the studio has one checkerboard material, not overlapping floors");
  assert.doesNotMatch(source, /\bplane:\(/u);
  assert.match(red, /emission:\[24\.0, 0\.18, 0\.07\]/u);
  assert.match(green, /emission:\[0\.07, 24\.0, 0\.18\]/u);
  assert.match(red, /casts_shadow:true/u);
  assert.match(green, /casts_shadow:true/u);
  assert.doesNotMatch(source, /id:"mirror_sun"|reflect_of_light_id/u,
    "virtual emitters must derive from the physical light and mirror geometry");
  assert.match(source, /view:\s*frame\.push\(\)/u);
  assert.match(source, /frame\.load\("ui\/main\.html"\)/u);
});

test("opposed finite red and green emitters orbit through retained time data", () => {
  const red = calls("frame.add").find((call) => idOf(call) === "red_emitter") ?? "";
  const green = calls("frame.add").find((call) => idOf(call) === "green_emitter") ?? "";
  const time = numericArrayBinding("t");
  const redPositions = numericArrayBinding("red_p");
  const greenPositions = numericArrayBinding("green_p");
  assert.deepEqual(time, Array.from({ length: 360 }, (_, degree) => degree));
  assert.equal(redPositions.length, 360);
  assert.equal(greenPositions.length, 360);
  for (let degree = 0; degree < 360; degree += 1) {
    const redPosition = redPositions[degree];
    const greenPosition = greenPositions[degree];
    assert.equal(redPosition[1], 0.24);
    assert.equal(greenPosition[1], 0.24);
    assert.ok(Math.abs(redPosition[0] + greenPosition[0]) < 1e-6);
    assert.ok(Math.abs((redPosition[2] + greenPosition[2]) - 0.08) < 1e-6);
  }
  assert.match(red, /p_t:red_p/u);
  assert.match(green, /p_t:green_p/u);
  assert.match(red, /s_t:source_size/u);
  assert.match(green, /s_t:source_size/u);
  assert.match(red, /t_mode:"repeat"/u);
  assert.match(green, /t_mode:"repeat"/u);
  assert.equal(numericArrayBinding("red_c").length, 360);
  assert.equal(numericArrayBinding("green_c").length, 360);
  assert.equal(numericArrayBinding("source_size").length, 360);
  assert.doesNotMatch(red, /\bx:|\by:|\bz:|kind:"point"|show_light_markers|source_radius/u,
    "an emitter is ordinary finite geometry with emissive properties");
});

test("rabbit gallery exposes playback controls beside capture", () => {
  assert.match(uiMarkup, /<button[^>]*data-vf-playback-toggle[^>]*>Pause<\/button>/u);
  assert.match(uiMarkup, /<button[^>]*data-vf-playback-reset[^>]*>Reset<\/button>/u);
  assert.match(uiMarkup, /<button[^>]*id="capture-frame"[^>]*>Capture<\/button>/u);
  assert.ok(
    uiMarkup.indexOf("data-vf-playback-toggle") <
      uiMarkup.indexOf("data-vf-playback-reset") &&
      uiMarkup.indexOf("data-vf-playback-reset") <
      uiMarkup.indexOf('id="capture-frame"'),
    "Play/Pause and Reset must share the compact control row beside Capture",
  );
});

test("rabbit gallery never flashes a focus border around the render canvas", () => {
  assert.match(
    uiStyles,
    /canvas\.vf-geom-canvas:focus,\s*canvas\.vf-geom-canvas:focus-visible\s*\{[\s\S]*outline:\s*none\s*!important;[\s\S]*box-shadow:\s*none\s*!important;/u,
  );
});

test("rabbit gallery source remains linked to hidden capture evidence", () => {
  assert.equal(manifest.source, sourcePath);
  assert.equal(manifest.capture.execution, "native hidden WebView2/WebGPU host");
  assert.equal(manifest.capture.api, "Frame.capture");
  assert.equal(manifest.capture.boundary, "frame-internal");
  assert.equal(manifest.source_sha256,
    createHash("sha256").update(Buffer.from(source)).digest("hex"));
  assert.equal(manifest.capture.samples, 360);
  assert.equal(manifest.capture.first_degree, 0);
  assert.equal(manifest.capture.last_degree, 359);
  assert.equal(manifest.capture.playback, "repeat");
  assert.notEqual(manifest.capture.first_frame_checksum,
    manifest.capture.last_frame_checksum);
});
