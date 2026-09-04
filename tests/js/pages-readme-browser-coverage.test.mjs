import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildReadmeDocument } from "../../tools/build-pages-readme.mjs";
import { createBrowserCompiler } from "../../web/playground/vkf-browser-compiler.mjs";

const root = new URL("../../", import.meta.url);
const artifacts = new URL("../../web/playground/artifacts/", import.meta.url);
const rounded = (values) => values.map((value) => Math.round(value * 1e9) / 1e9);

async function compilerAndExamples() {
  const [document, wasm, manifest] = await Promise.all([
    buildReadmeDocument(root),
    readFile(new URL("vkf-browser-compiler.wasm", artifacts)),
    readFile(new URL("vkf-browser-compiler.json", artifacts), "utf8").then(JSON.parse),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm);
  return { compiler: createBrowserCompiler({ instance, manifest }), examples: document.examples };
}

test("browser coverage matrix classifies every README VKF fence exactly once", async () => {
  const [matrix, document] = await Promise.all([
    readFile(new URL("../fixtures/pages-readme-browser-coverage.json", import.meta.url), "utf8").then(JSON.parse),
    buildReadmeDocument(root),
  ]);
  const classified = matrix.clusters.flatMap(({ examples }) => examples);

  assert.equal(classified.length, 26);
  assert.deepEqual([...new Set(classified)].sort(), document.examples.map(({ id }) => id).sort());
});

test("browser compiler runs the complete README recursive vector-lifting fence", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-01");

  assert.deepEqual({ ...compiler.run(example.source) }, {
    kind: "console",
    values: [[2, 4, 6], [[2, 4], [6, 8]]],
  });
  assert.deepEqual({ ...compiler.run([
    "triple(item:int) -> int: item * 3",
    ":: triple([2, 4])",
    ":: triple([[1, 3], [5, 7]])",
  ].join("\n")) }, {
    kind: "console",
    values: [[6, 12], [[3, 9], [15, 21]]],
  });
});

test("browser compiler runs the complete README named-axis tensor fence", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-02");

  assert.deepEqual({ ...compiler.run(example.source) }, {
    kind: "console",
    values: [
      [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
      [4, 10, 18],
      [[[15, 18], [20, 24]], [[30, 36], [40, 48]]],
    ],
  });
  assert.deepEqual({ ...compiler.run([
    "hadamard: [2, 3]->row * [5, 7]->row",
    "outer: [2, 4]->x * [3, 5]->y",
    ":: outer",
    ":: hadamard",
  ].join("\n")) }, {
    kind: "console",
    values: [[[6, 10], [12, 20]], [10, 21]],
  });
});

test("browser compiler emits retained geometry packets for the complete README display fence", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-03");
  const output = { ...compiler.run(example.source) };

  assert.equal(output.kind, "visual");
  assert.equal(output.packet_records.length, 1);
  const packet = { ...output.packet_records[0] };
  assert.deepEqual([packet.magic, packet.version, packet.rows, packet.columns], [1447773766, 5, 2, 7]);
  assert.deepEqual(rounded(packet.color), [0.12, 0.72, 1, 1]);
  assert.deepEqual(rounded(packet.x[0]), [-3, -2, -1, 0, 1, 2, 3]);
  assert.deepEqual(rounded(packet.y[0]), [-0.12, -0.92, -0.86, -0.03, 0.82, 0.88, 0.09]);

  const changed = { ...compiler.run([
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0, 0], size:[1, 1])",
    "frame.add(x:[[1, 2]], y:[[3, 4]], z:[[5, 6]], id:\"probe\", color:[0.1, 0.2, 0.3, 1])",
  ].join("\n")) };
  assert.equal(changed.packet_records.length, 1);
  assert.deepEqual(rounded(changed.packet_records[0].color), [0.1, 0.2, 0.3, 1]);
  assert.deepEqual(changed.packet_records[0].x, [[1, 2]]);
  assert.deepEqual(changed.packet_records[0].y, [[3, 4]]);
});

test("browser compiler retains background options and multiple meshes from README displays", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const bands = examples.find(({ id }) => id === "readme-16");
  const ribbon = examples.find(({ id }) => id === "readme-20");
  const bandOutput = { ...compiler.run(bands.source) };
  const ribbonOutput = { ...compiler.run(ribbon.source) };

  assert.equal(bandOutput.kind, "visual");
  assert.equal(bandOutput.packet_records.length, 4);
  assert.deepEqual(rounded(bandOutput.packet_records[0].color), [0.015, 0.022, 0.05, 1]);
  assert.deepEqual(bandOutput.packet_records.slice(1).map((packet) => [
    packet.magic, packet.version, packet.rows, packet.columns,
  ]), [
    [1447773766, 5, 2, 7],
    [1447773766, 5, 2, 7],
    [1447773766, 5, 2, 7],
  ]);
  assert.equal(ribbonOutput.packet_records.length, 2);
  assert.deepEqual([
    ribbonOutput.packet_records[1].magic,
    ribbonOutput.packet_records[1].version,
    ribbonOutput.packet_records[1].rows,
    ribbonOutput.packet_records[1].columns,
  ], [1447773766, 5, 2, 25]);

  const changed = { ...compiler.run(bands.source
    .replace("background:[0.015, 0.022, 0.05, 1]", "background:[0.2, 0.3, 0.4, 1]")
    .replace("color:[0.1, 0.5, 0.98, 1]", "color:[0.9, 0.8, 0.7, 1]")) };
  assert.deepEqual(rounded(changed.packet_records[0].color), [0.2, 0.3, 0.4, 1]);
  assert.deepEqual(rounded(changed.packet_records[1].color), [0.9, 0.8, 0.7, 1]);

  const combined = { ...compiler.run(bands.source.replace(
      "unified_renderer:true",
      "unified_renderer:true, combine_transparent:true",
    )) };
  assert.equal(combined.packet_records.length, 4);
  assert.throws(
    () => compiler.run(bands.source.replace(
      "unified_renderer:true",
      "unified_renderer:true, combine_transparent:false",
    )),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(bands.source.replace(
      "id:\"lower_band\"",
      "id:\"lower_band\", opacity:0.5",
    )),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains the README camera, light, and 3D surface scene", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-04");
  const output = { ...compiler.run(example.source) };

  assert.equal(output.kind, "visual");
  assert.equal(output.packet_records.length, 4);
  assert.deepEqual({ ...output.packet_records[1] }, {
    magic: 1447773768,
    version: 1,
    pos: [4.2, -5.4, 3.5],
    target: [0, 0, 0.25],
    up: [0, 0, 1],
    fov: 42,
  });
  assert.deepEqual({
    ...output.packet_records[2],
    color: rounded(output.packet_records[2].color),
  }, {
    magic: 1447773769,
    version: 1,
    pos: [2.8, -2.6, 5.2],
    target: [0, 0, 0],
    color: [1, 0.88, 0.68, 1],
    intensity: 24,
    range: 18,
    casts_shadow: true,
    source_radius: 0,
  });
  assert.deepEqual(rounded(output.packet_records[3].z[1]), [0.2, 1.15, 0.35]);
  assert.equal(output.packet_records[3].receives_lighting, true);
  assert.equal(output.packet_records[3].casts_shadow, true);

  const changed = { ...compiler.run(example.source
    .replace("fov:42", "fov:55")
    .replace("intensity:24", "intensity:12")
    .replace("[0.2, 1.15, 0.35]", "[0.4, 1.35, 0.55]")) };
  assert.equal(changed.packet_records[1].fov, 55);
  assert.equal(changed.packet_records[2].intensity, 12);
  assert.deepEqual(rounded(changed.packet_records[3].z[1]), [0.4, 1.35, 0.55]);

  assert.throws(
    () => compiler.run(example.source.replace("fov:42", "fov:42, aperture:1")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(example.source.replace(
      "id:\"sun\"",
      "id:\"sun\", kind:\"directional\"",
    )),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains README lit materials and receiver-shadow ownership", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const shadows = examples.find(({ id }) => id === "readme-08");
  const lights = examples.find(({ id }) => id === "readme-09");
  const material = examples.find(({ id }) => id === "readme-15");
  const shadowOutput = { ...compiler.run(shadows.source) };
  const lightOutput = { ...compiler.run(lights.source) };
  const materialOutput = { ...compiler.run(material.source) };

  assert.equal(shadowOutput.packet_records.length, 6);
  assert.equal(rounded([shadowOutput.packet_records[2].source_radius])[0], 0.12);
  assert.equal(shadowOutput.packet_records[3].receives_shadow, true);
  assert.deepEqual(
    shadowOutput.packet_records.slice(4).map(({ casts_shadow }) => casts_shadow),
    [true, true],
  );
  assert.equal(lightOutput.packet_records.length, 5);
  assert.deepEqual(
    lightOutput.packet_records.slice(2, 4).map(({ casts_shadow }) => casts_shadow),
    [true, false],
  );
  assert.deepEqual(rounded([
    materialOutput.packet_records[3].roughness,
    materialOutput.packet_records[3].specular_strength,
  ]), [0.24, 0.78]);

  const changed = { ...compiler.run(material.source
    .replace("roughness:0.24", "roughness:0.41")
    .replace("specular_strength:0.78", "specular_strength:0.33")) };
  assert.deepEqual(rounded([
    changed.packet_records[3].roughness,
    changed.packet_records[3].specular_strength,
  ]), [0.41, 0.33]);
  assert.throws(
    () => compiler.run(material.source.replace(
      "roughness:0.24",
      "roughness:0.24, metalness:0.5",
    )),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains source-derived README procedural textures", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const checker = examples.find(({ id }) => id === "readme-07");
  const grass = examples.find(({ id }) => id === "readme-10");
  const checkerOutput = { ...compiler.run(checker.source) };
  const grassOutput = { ...compiler.run(grass.source) };
  assert.deepEqual({ ...checkerOutput.packet_records.at(-1).texture }, {
    magic: 1447773770, version: 1,
    kind: "checker", scale: [7, 6], color_a: [0.03, 0.05, 0.09, 1],
    color_b: [0.28, 0.55, 0.9, 1], roughness: 1,
    blade_length: 0, clump_density: 0, micro_shadow: 0,
  });
  assert.deepEqual([
    grassOutput.packet_records.at(-1).texture.magic,
    grassOutput.packet_records.at(-1).texture.version,
  ], [1447773770, 1]);
  assert.equal(grassOutput.packet_records.at(-1).texture.kind, "grass");
  assert.deepEqual(rounded([
    grassOutput.packet_records.at(-1).texture.blade_length,
    grassOutput.packet_records.at(-1).texture.clump_density,
    grassOutput.packet_records.at(-1).texture.micro_shadow,
  ]), [1.1, 1.2, 0.52]);
  const changed = { ...compiler.run(checker.source.replace("scale:[7, 6]", "scale:[3, 4]")) };
  assert.deepEqual(changed.packet_records.at(-1).texture.scale, [3, 4]);
  assert.throws(
    () => compiler.run(checker.source.replace("scale:[7, 6]", "scale:[7, 6], seed:4")),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains source-derived transparent optical material", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const glass = examples.find(({ id }) => id === "readme-06");
  const mirror = examples.find(({ id }) => id === "readme-05");
  const output = { ...compiler.run(glass.source) };
  assert.deepEqual({ ...output.packet_records.at(-1).optical }, {
    magic: 1447773771, version: 1, alpha: 0.52,
    transparent: true, depth_write: false, reflectivity: 0.28,
  });
  const changed = { ...compiler.run(glass.source
    .replace("alpha:0.52", "alpha:0.22")
    .replace("depth_write:false", "depth_write:true")
    .replace("reflectivity:0.28", "reflectivity:0.48")) };
  assert.deepEqual(rounded([
    changed.packet_records.at(-1).optical.alpha,
    changed.packet_records.at(-1).optical.reflectivity,
  ]), [0.22, 0.48]);
  assert.equal(changed.packet_records.at(-1).optical.depth_write, true);
  assert.throws(
    () => compiler.run(glass.source.replace("reflectivity:0.28", "reflectivity:0.28, ior:1.5")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(() => compiler.run(mirror.source), /browser compiler could not run the VKF source/u);
});

test("browser execution coverage is measured against all 26 README VKF fences", async () => {
  const [{ compiler, examples }, matrix] = await Promise.all([
    compilerAndExamples(),
    readFile(new URL("../fixtures/pages-readme-browser-coverage.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const runnable = [];

  for (const example of examples) {
    try {
      compiler.run(example.source);
      runnable.push(example.id);
    } catch (error) {
      assert.match(error.message, /browser compiler could not run the VKF source/u);
    }
  }

  assert.deepEqual(runnable, matrix.browser_runnable_after_slice);
  assert.equal(runnable.length, 12);
  assert.equal(examples.length, 26);
});
