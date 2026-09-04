import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildReadmeDocument } from "../../tools/build-pages-readme.mjs";
import { materializeVisualOutput } from "../../web/inline-result-packets.mjs";
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
});

test("browser compiler retains the README mirror surface and virtual camera", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const mirror = examples.find(({ id }) => id === "readme-05");
  const output = { ...compiler.run(mirror.source) };
  assert.deepEqual({ ...output.packet_records.at(-1).surface_system }, {
    magic: 1447773773, version: 1, kind: "screen", reflectivity: 0.9,
    reverse_facing: true, flip_y: true, scale: [1, 1], camera_fov: 43,
    camera_up: [0, 0, 1], mirror_frame_id: "frame_0", mirror_mesh_id: "mirror",
    reflect_eye_only: true, lock_aperture_camera: true, controls_enabled: false,
  });
  assert.equal(materializeVisualOutput(output).packets.at(-1)[1], 7);
  const changed = { ...compiler.run(mirror.source
    .replace('surface_system:(kind:"screen", reflectivity:0.9', 'surface_system:(kind:"screen", reflectivity:0.6')
    .replace("camera:(fov:43", "camera:(fov:50")) };
  assert.deepEqual(rounded([
    changed.packet_records.at(-1).surface_system.reflectivity,
    changed.packet_records.at(-1).surface_system.camera_fov,
  ]), [0.6, 50]);
  const changedPacket = materializeVisualOutput(changed).packets.at(-1);
  assert.deepEqual(rounded([changedPacket[18], changedPacket[23]]), [0.6, 50]);
  assert.throws(
    () => compiler.run(mirror.source.replace("camera:(fov:43", "camera:(fov:43, lens_shift:0.2")),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler applies the README World embedding to its retained particle", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const world = examples.find(({ id }) => id === "readme-19");
  const controls = examples.find(({ id }) => id === "readme-11");
  const output = { ...compiler.run(world.source) };
  const particle = { ...output.packet_records.at(-1) };
  assert.deepEqual([particle.magic, particle.version], [1447773774, 1]);
  assert.deepEqual(rounded([
    ...particle.position, ...particle.color, particle.size, particle.mass,
  ]), [0, 0, 0.12, 0.72, 1, 1, 0.7, 1]);
  assert.deepEqual(rounded([...materializeVisualOutput(output).packets.at(-1)]), [
    1447773774, 1, 0, 0, 0.12, 0.72, 1, 1, 0.7, 1,
  ]);
  const changed = { ...compiler.run(world.source
    .replace("[0, 0], [0.12, 0.72, 1, 1], 0.35, 1", "[1.5, -0.5], [1, 0.2, 0.1, 1], 0.55, 2")) };
  assert.deepEqual(rounded([
    ...changed.packet_records.at(-1).position,
    ...changed.packet_records.at(-1).color,
    changed.packet_records.at(-1).size,
    changed.packet_records.at(-1).mass,
  ]), [1.5, -0.5, 1, 0.2, 0.1, 1, 1.1, 2]);
  assert.throws(
    () => compiler.run(world.source.replace("gravity:false", "gravity:true")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(world.source.replace("rigid_collisions:false", "rigid_collisions:false, drag:0.2")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(world.source.replace("particle.radius * 2", "particle.radius * 3")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(() => compiler.run(controls.source), /browser compiler could not run the VKF source/u);
});

test("browser compiler retains the README native indexed field mesh", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const wireframe = examples.find(({ id }) => id === "readme-21");
  const output = { ...compiler.run(wireframe.source) };
  assert.equal(output.packet_records[0].magic, 1447773767);
  assert.equal(output.packet_records[1].magic, 1447773768);
  const mesh = { ...output.packet_records[2] };
  assert.deepEqual([
    mesh.magic, mesh.version, mesh.topology, mesh.render_mode,
    mesh.mode3d, mesh.vertices.length, mesh.indices.length,
  ], [1447773775, 1, "line-list", "line", true, 50, 16]);
  assert.deepEqual(rounded([
    ...mesh.vertices.slice(0, 10), ...mesh.color,
  ]), [-1.4, -0.8, 0, 0, 0, 1, 0.1, 0.72, 1, 1, 0.1, 0.72, 1, 1]);
  const typed = materializeVisualOutput(output).packets[2];
  assert.deepEqual([...typed.slice(0, 8)], [
    1447773775, 1, 5, 16, 0.1, 0.72, 1, 1,
  ]);
  const changed = { ...compiler.run(wireframe.source
    .replace("vertices:[-1.4, -0.8", "vertices:[-2.4, -0.8")
    .replace("color:[0.1, 0.72, 1, 1]", "color:[1, 0.3, 0.1, 1]")) };
  assert.deepEqual(rounded([
    changed.packet_records[2].vertices[0], ...changed.packet_records[2].color,
  ]), [-2.4, 1, 0.3, 0.1, 1]);
  assert.throws(
    () => compiler.run(wireframe.source.replace('render_mode:"line"', 'render_mode:"line", line_width:2')),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(wireframe.source.replace('title:"Wireframe points",', 'title:"Wireframe points", exposure:1,')),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains the README native roughness scene", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const roughness = examples.find(({ id }) => id === "readme-13");
  const output = { ...compiler.run(roughness.source) };

  assert.deepEqual(output.packet_records.map(({ magic }) => magic), [
    1447773767, 1447773768, 1447773766,
    1447773776, 1447773776, 1447773776,
    1447773769, 1447773769,
  ]);
  assert.deepEqual(output.packet_records.slice(3, 6).map((cube) => ({
    center: rounded(cube.center),
    size: rounded([cube.size])[0],
    color: rounded(cube.color),
    roughness: rounded([cube.roughness])[0],
    specular_strength: rounded([cube.specular_strength])[0],
    casts_shadow: cube.casts_shadow,
    receives_shadow: cube.receives_shadow,
  })), [
    { center: [-2, 1, 0.9], size: 1.6, color: [0.32, 0.4, 0.55, 1], roughness: 0.95, specular_strength: 1, casts_shadow: true, receives_shadow: true },
    { center: [0, 1, 0.9], size: 1.6, color: [0.32, 0.4, 0.55, 1], roughness: 0.35, specular_strength: 1, casts_shadow: true, receives_shadow: true },
    { center: [2, 1, 0.9], size: 1.6, color: [0.32, 0.4, 0.55, 1], roughness: 0.02, specular_strength: 1, casts_shadow: true, receives_shadow: true },
  ]);
  assert.deepEqual(rounded([...materializeVisualOutput(output).packets[3]]), [
    1447773776, 1, -2, 1, 0.9, 1.6, 0.32, 0.4, 0.55, 1, 0.95, 1, 1, 1,
  ]);

  const changed = { ...compiler.run(roughness.source
    .replace('center:[-2, 1, 0.9]', 'center:[-2.5, 1.4, 1.2]')
    .replace('roughness:0.95', 'roughness:0.72')) };
  assert.deepEqual(rounded(changed.packet_records[3].center), [-2.5, 1.4, 1.2]);
  assert.equal(rounded([changed.packet_records[3].roughness])[0], 0.72);
  assert.throws(
    () => compiler.run(roughness.source.replace('roughness:0.95', 'roughness:0.95, rotation:[0, 0, 0]')),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(roughness.source.replace('title:"Roughness",', 'title:"Roughness", exposure:1,')),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains the animated README sun-reflection scene", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-12");
  const output = { ...compiler.run(example.source) };

  assert.deepEqual(output.packet_records.map(({ magic }) => magic), [
    1447773767, 1447773768, 1447773780, 1447773766,
    1447773779, 1447773781, 1447773782,
  ]);
  assert.deepEqual({
    ...output.packet_records[2],
    light_marker_size: rounded([output.packet_records[2].light_marker_size])[0],
  }, {
    magic: 1447773780, version: 1, fps: 30, duration_seconds: 14,
    boundary: "repeat", aspect: "equal", show_light_markers: true,
    light_marker_size: 0.24,
  });
  assert.deepEqual({ ...output.packet_records[4].surface_system }, {
    magic: 1447773773, version: 1, kind: "screen", reflectivity: 1,
    reverse_facing: true, flip_y: true, scale: [1, 1], camera_fov: 34,
    camera_up: [0, 0, 1], mirror_frame_id: "solkatt_frame", mirror_mesh_id: "mirror",
    reflect_eye_only: true, lock_aperture_camera: true, controls_enabled: false,
  });
  assert.equal(output.packet_records[4].id, "mirror");
  assert.equal(output.packet_records[4].no_backface_specular, true);
  assert.deepEqual({
    ...output.packet_records[5], color: rounded(output.packet_records[5].color),
  }, {
    magic: 1447773781, version: 1, id: "sun", kind: "point", motion: "orbit",
    radius: 4.35, height: 3.3, theta: -0.98, angular_velocity: 0.55,
    target: [0, 0.4, 0.9], model: "blinn_phong", color: [1, 0.94, 0.8, 1],
    intensity: 22, range: 18, casts_shadow: true, show_marker: true,
    source_radius: 0.14, spread: 1,
  });
  assert.deepEqual({
    ...output.packet_records[6], color: rounded(output.packet_records[6].color),
  }, {
    magic: 1447773782, version: 1, id: "solkatt", kind: "projected",
    reflect_of_light_id: "sun", reflect_mirror_mesh_id: "mirror",
    model: "blinn_phong", color: [1, 0.94, 0.8, 1], intensity: 80,
    range: 18, casts_shadow: true, show_marker: false,
    source_radius: 0.14, spread: 1, aperture_face_id: "mirror",
  });
  const typed = materializeVisualOutput(output).packets;
  assert.equal(typed[2].length, 8);
  assert.equal(typed[4][1], 2);
  assert.equal(typed[5][0], 1447773781);
  assert.equal(typed[6][0], 1447773782);

  const changed = { ...compiler.run(example.source
    .replace("light_marker_size:0.24", "light_marker_size:0.38")
    .replace("radius:4.35", "radius:3.2")
    .replace("angular_velocity:0.55", "angular_velocity:0.8")
    .replace("intensity:80", "intensity:52")) };
  assert.equal(rounded([changed.packet_records[2].light_marker_size])[0], 0.38);
  assert.deepEqual(rounded([
    changed.packet_records[5].radius,
    changed.packet_records[5].angular_velocity,
    changed.packet_records[6].intensity,
  ]), [3.2, 0.8, 52]);
  assert.throws(
    () => compiler.run(example.source.replace("spread:1", "spread:1, falloff:2")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(example.source.replace('reflect_of_light_id:"sun"', 'reflect_of_light_id:"missing"')),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains the README native spotlight cone", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const spotlight = examples.find(({ id }) => id === "readme-17");
  const output = { ...compiler.run(spotlight.source) };

  assert.deepEqual(output.packet_records.map(({ magic }) => magic), [
    1447773767, 1447773768, 1447773766,
    1447773776, 1447773776, 1447773777,
  ]);
  assert.deepEqual({
    ...output.packet_records.at(-1),
    pos: rounded(output.packet_records.at(-1).pos),
    target: rounded(output.packet_records.at(-1).target),
    color: rounded(output.packet_records.at(-1).color),
  }, {
    magic: 1447773777, version: 1, kind: "spot",
    pos: [-2.8, -2.4, 5.8], target: [0, 1, 0.4],
    color: [1, 0.84, 0.56, 1], intensity: 65, range: 18,
    inner_cone_deg: 12, outer_cone_deg: 24,
    casts_shadow: true, source_radius: 0.08,
  });
  assert.deepEqual(rounded([...materializeVisualOutput(output).packets.at(-1)]), [
    1447773777, 1, -2.8, -2.4, 5.8, 0, 1, 0.4,
    1, 0.84, 0.56, 1, 65, 18, 12, 24, 1, 0.08,
  ]);

  const changed = { ...compiler.run(spotlight.source
    .replace("target:[0, 1, 0.4]", "target:[1.2, 0.4, 0.8]")
    .replace("outer_cone_deg:24", "outer_cone_deg:36")) };
  assert.deepEqual(rounded(changed.packet_records.at(-1).target), [1.2, 0.4, 0.8]);
  assert.equal(changed.packet_records.at(-1).outer_cone_deg, 36);
  assert.throws(
    () => compiler.run(spotlight.source.replace("outer_cone_deg:24", "outer_cone_deg:24, falloff:2")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(spotlight.source.replace("inner_cone_deg:12", "inner_cone_deg:28")),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains the README rotated procedural die", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const dice = examples.find(({ id }) => id === "readme-18");
  const output = { ...compiler.run(dice.source) };

  assert.deepEqual(output.packet_records.map(({ magic }) => magic), [
    1447773767, 1447773768, 1447773766, 1447773776, 1447773769,
  ]);
  assert.deepEqual({
    ...output.packet_records[2].texture,
    color_a: rounded(output.packet_records[2].texture.color_a),
    color_b: rounded(output.packet_records[2].texture.color_b),
  }, {
    magic: 1447773770, version: 1, kind: "checker", scale: [1, 1],
    color_a: [0.09, 0.14, 0.13, 1], color_b: [0.32, 0.42, 0.36, 1],
    roughness: 1, blade_length: 0, clump_density: 0, micro_shadow: 0,
  });
  const die = { ...output.packet_records[3] };
  assert.deepEqual([die.magic, die.version], [1447773776, 2]);
  assert.deepEqual(rounded(die.rotation), [24, -18, 32]);
  assert.deepEqual({
    ...die.texture,
    color_a: rounded(die.texture.color_a),
    color_b: rounded(die.texture.color_b),
  }, {
    magic: 1447773778, version: 1, kind: "dice",
    color_a: [0.98, 0.98, 1, 1], color_b: [0.025, 0.025, 0.035, 1],
    graph_width_px: 3,
  });
  assert.deepEqual(rounded([...materializeVisualOutput(output).packets[3]].slice(14)), [
    24, -18, 32, 1447773778, 1, 1,
    0.98, 0.98, 1, 1, 0.025, 0.025, 0.035, 1, 3,
  ]);

  const changed = { ...compiler.run(dice.source
    .replace("rotation:[24, -18, 32]", "rotation:[10, 20, 30]")
    .replace("color_a:[0.98, 0.98, 1, 1]", "color_a:[0.3, 0.8, 1, 1]")
    .replace("graph_width_px:3", "graph_width_px:5")) };
  assert.deepEqual(rounded(changed.packet_records[3].rotation), [10, 20, 30]);
  assert.deepEqual(rounded(changed.packet_records[3].texture.color_a), [0.3, 0.8, 1, 1]);
  assert.equal(changed.packet_records[3].texture.graph_width_px, 5);
  assert.throws(
    () => compiler.run(dice.source.replace("graph_width_px:3", "graph_width_px:3, seed:4")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(dice.source.replace("rotation:[24, -18, 32]", "rotation:[24, -18]")),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains the README layered native glass surfaces", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const layered = examples.find(({ id }) => id === "readme-14");
  const output = { ...compiler.run(layered.source) };

  assert.deepEqual(output.packet_records.map(({ magic }) => magic), [
    1447773767, 1447773768, 1447773766,
    1447773779, 1447773779, 1447773769,
  ]);
  const [backdrop, glass] = output.packet_records.slice(3, 5).map((record) => ({ ...record }));
  assert.deepEqual(rounded([...backdrop.center, ...backdrop.size, ...backdrop.rotation]), [
    0, 3.8, 1.8, 5.6, 3.3, 90, 0, 0,
  ]);
  assert.deepEqual([backdrop.texture, backdrop.optical, backdrop.surface_system], [[], [], []]);
  assert.deepEqual(rounded([...glass.center, ...glass.size, ...glass.rotation]), [
    0, 0.7, 1.8, 4.6, 3.2, 90, 0, 0,
  ]);
  assert.deepEqual({
    ...glass.optical,
    alpha: rounded([glass.optical.alpha])[0],
    reflectivity: rounded([glass.optical.reflectivity])[0],
  }, {
    magic: 1447773771, version: 1, alpha: 0.48,
    transparent: true, depth_write: false, reflectivity: 0.42,
  });
  assert.deepEqual({
    ...glass.texture,
    color_a: rounded(glass.texture.color_a), color_b: rounded(glass.texture.color_b),
  }, {
    magic: 1447773770, version: 1, kind: "checker", scale: [6, 4],
    color_a: [0.05, 0.7, 0.95, 0.42], color_b: [0.3, 0.95, 0.72, 0.58],
    roughness: 1, blade_length: 0, clump_density: 0, micro_shadow: 0,
  });
  assert.deepEqual({
    ...glass.surface_system,
    reflectivity: rounded([glass.surface_system.reflectivity])[0],
  }, {
    magic: 1447773773, version: 1, kind: "screen", reflectivity: 0.42,
    reverse_facing: true, flip_y: true, scale: [1, 1], camera_fov: 42,
    camera_up: [0, 0, 1], mirror_frame_id: "layered_frame",
    mirror_mesh_id: "layered_glass", reflect_eye_only: true,
    lock_aperture_camera: true, controls_enabled: false,
  });
  assert.equal(materializeVisualOutput(output).packets[4].length, 56);

  const changed = { ...compiler.run(layered.source
    .replace("center:[0, 0.7, 1.8]", "center:[0.4, 1.2, 2]")
    .replace("alpha:0.48", "alpha:0.35")
    .replace("scale:[6, 4]", "scale:[3, 2]")) };
  assert.deepEqual(rounded(changed.packet_records[4].center), [0.4, 1.2, 2]);
  assert.equal(rounded([changed.packet_records[4].optical.alpha])[0], 0.35);
  assert.deepEqual(changed.packet_records[4].texture.scale, [3, 2]);
  assert.throws(
    () => compiler.run(layered.source.replace("specular_strength:0.9", "specular_strength:0.9, blend_mode:\"add\"")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(layered.source.replace("camera:(fov:42", "camera:(fov:42, lens_shift:0.2")),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler retains the README rigid-body world", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-22");
  const output = { ...compiler.run(example.source) };

  assert.deepEqual(output.packet_records.map(({ magic, version }) => [magic, version]), [
    [1447773767, 1], [1447773768, 2], [1447773780, 2], [1447773769, 2],
    [1447773783, 1], [1447773784, 1], [1447773784, 1],
  ]);
  assert.deepEqual({ ...output.packet_records[1] }, {
    magic: 1447773768, version: 2, pos: [0, 0, 12], target: [0, 0, 0],
    up: [0, 1, 0], projection: "orthographic", ortho_scale: 6,
  });
  assert.deepEqual({ ...output.packet_records[4] }, {
    magic: 1447773783, version: 1, width: 10, height: 6, gravity: [0, -3],
    solver_iterations: 10, step_dt: 0.008333, max_substeps: 8,
  });
  assert.equal(output.packet_records[5].id, "floor");
  assert.equal(output.packet_records[5].static, true);
  assert.equal(output.packet_records[6].id, "spinner");
  assert.deepEqual(output.packet_records[6].velocity, [2.4, 0]);
  assert.equal(output.packet_records[6].angular_velocity, 2.8);
  assert.equal(rounded([output.packet_records[6].e_n])[0], 0.86);
  const typed = materializeVisualOutput(output).packets;
  assert.deepEqual(typed.map(({ length }) => length), [6, 13, 5, 13, 9, 25, 25]);

  const changed = { ...compiler.run(example.source
    .replace("ortho_scale:6", "ortho_scale:4")
    .replace("gravity:[0, -3]", "gravity:[0, -5]")
    .replace("velocity:[2.4, 0]", "velocity:[1.2, 0]")
    .replace("angular_velocity:2.8", "angular_velocity:1.4")) };
  assert.equal(changed.packet_records[1].ortho_scale, 4);
  assert.deepEqual(changed.packet_records[4].gravity, [0, -5]);
  assert.deepEqual(changed.packet_records[6].velocity, [1.2, 0]);
  assert.equal(changed.packet_records[6].angular_velocity, 1.4);
  assert.throws(
    () => compiler.run(example.source.replace("max_substeps:8", "max_substeps:8, damping:0.1")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(example.source.replace("e_n:0.86", "e_n:0.86, friction:0.1")),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler runs the complete README basic-syntax fence", async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-23");

  assert.deepEqual({ ...compiler.run(example.source) }, {
    kind: "console",
    values: [10, 2],
  });
  assert.deepEqual({ ...compiler.run(example.source.replace(".total+: $", ".total+: $ * 2")) }, {
    kind: "console",
    values: [20, 2],
  });
  assert.throws(
    () => compiler.run(example.source.replace("2 => @|", "2 => @>")),
    /browser compiler could not run the VKF source/u,
  );
});

test("browser compiler runs the complete README spectral-norm fence", { timeout: 10_000 }, async () => {
  const { compiler, examples } = await compilerAndExamples();
  const example = examples.find(({ id }) => id === "readme-24");

  assert.deepEqual({ ...compiler.run(example.source) }, {
    kind: "console",
    values: [1.2742241159529069],
  });
  assert.deepEqual({ ...compiler.run(example.source.replace(
    "sqrt(result.numerator / result.denominator)",
    "sqrt(result.numerator / result.denominator) * 2",
  )) }, {
    kind: "console",
    values: [2.5484482319058137],
  });
  const fewerIterations = compiler.run(example.source.replace("..9 >>", "..1 >>"));
  assert.equal(fewerIterations.kind, "console");
  assert.equal(Math.round(fewerIterations.values[0] * 1e14) / 1e14, 1.27422411594123);
  assert.throws(
    () => compiler.run(example.source.replace("sqrt(", "cbrt(")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(example.source.replace(
      "state.v: multiply_at_av(state.u)",
      "state.v: multiply_at_av(state.v)",
    )),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(example.source.replace(":: spectral_norm()", ":: multiply_at_av()")),
    /browser compiler could not run the VKF source/u,
  );
  assert.throws(
    () => compiler.run(example.source.replaceAll("500", "1000000")),
    /browser compiler could not run the VKF source/u,
  );
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
  assert.equal(runnable.length, 23);
  assert.equal(examples.length, 26);
});
