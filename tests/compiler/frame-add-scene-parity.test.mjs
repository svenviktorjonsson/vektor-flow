import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const require = createRequire(import.meta.url);
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const workRoot = path.join(repositoryRoot, ".w", `g01n-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function stage(name, input, args = []) {
  const executable = path.isAbsolute(name) ? name : compilerTool(name);
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

function compile(source) {
  const tokens = stage("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = stage("vkf_parser_token_stream_smoke", tokens);
  return JSON.parse(stage("vkf_ast_to_ir_smoke", ast));
}

const litSurfaceSource = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.04, 0.06], size:[0.72, 0.84])",
  "frame.set_geom_options(background:[0.015, 0.02, 0.035, 1.0], unified_renderer:true)",
  "frame.add_camera(pos:[4.0, -6.0, 4.2], target:[0.0, 0.8, 0.4], up:[0.0, 0.0, 1.0], fov:40.0)",
  "key: frame.add(x:[[2.4, 2.6], [2.4, 2.6]], y:[[-3.1, -3.1], [-2.9, -2.9]], z:[[4.5, 4.5], [4.5, 4.5]], id:\"key\", color:[1.0, 0.92, 0.78, 1.0], emission:[28.0, 25.76, 21.84], casts_shadow:false)",
  "surface: frame.add(x:[[-1.5, 1.5], [-1.5, 1.5]], y:[[0.0, 0.0], [2.0, 2.0]], z:[[0.0, 0.0], [0.0, 0.0]], id:\"lit_surface\", color:[0.16, 0.52, 0.92, 1.0], representation:\"faces\", receives_lighting:true, casts_shadow:true)",
].join("\n");

const rectangularSurfaceSource = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
  "surface: frame.add(x:[[-3, -2, -1, 0, 1, 2, 3], [-3, -2, -1, 0, 1, 2, 3]], y:[[-0.12, -0.92, -0.86, -0.03, 0.82, 0.88, 0.09], [-0.06, -0.86, -0.80, 0.03, 0.88, 0.94, 0.15]], z:[[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]], id:\"sine\", color:[0.12, 0.72, 1.0, 1.0])",
].join("\n");

const spectralEmissionSource = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.04, 0.06], size:[0.72, 0.84])",
  "surface: frame.add(x:[[-1.0, 1.0], [-1.0, 1.0]], y:[[0.0, 0.0], [2.0, 2.0]], z:[[0.0, 0.0], [0.0, 0.0]], id:\"emitter\", color:[0.2, 0.2, 0.2, 1.0], emission:(wavelength:[460, 550, 610], radiance:[0.2, 0.4, 0.8]))",
].join("\n");

const linePlotSource = [
  ": .ui.display",
  ":.math",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
  "x: [..512] / 256 - 1",
  "line: frame.add(x:x, y:sin(x * pi), id:\"sine\", color:[0.12, 0.72, 1.0, 1.0])",
].join("\n");

const rangeSurfaceSource = [
  ": .ui.display",
  ":.math",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
  "u: ([..32] / 32 * 2 * pi) -> u",
  "v: ([..24] / 24 * pi) -> v",
  "x: cos(u) * sin(v)",
  "y: sin(u) * sin(v)",
  "z: cos(v)",
  "surface: frame.add(x:x, y:y, z:z, id:\"sphere\", color:[0.2, 0.7, 1.0, 1.0])",
].join("\n");

const temporalEmitterSource = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.04, 0.06], size:[0.72, 0.84])",
  "t: [0, 2.094395102, 4.188790205, 6.283185307]",
  "p: [[1, 0], [0, 1], [-1, 0], [1, 0]]",
  "emitter: frame.add(p_t:p, c_tc:[[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]], s_t:[0.2, 0.2, 0.2, 0.2], t:t, t_mode:\"repeat\", s_mode:data)",
  "view: frame.push()",
].join("\n");

test("Frame add retains Layer-local t coordinates and repeat playback", () => {
  const typedIr = compile(temporalEmitterSource);
  assert.deepEqual(typedIr.ui_program.operations.map(({ kind }) => kind), [
    "add_frame",
    "add",
    "push",
  ]);
  const add = typedIr.ui_program.operations[1];
  assert.deepEqual(add.layer_axes, ["t"]);
  assert.equal(add.time.axis, "t");
  assert.equal(add.time.coordinates.type, "[num:4]");
  assert.equal(add.time.mode.value, "repeat");
  assert.deepEqual(
    add.channels.map(({ value: _value, ...channel }) => channel),
    [
      { name: "p", semantic_axes: ["t", "c"], shape: [4, 2], value_kind: "position" },
      { name: "c", semantic_axes: ["t", "c"], shape: [4, 4], broadcast_axes: [], value_kind: "rgba" },
      { name: "s", semantic_axes: ["t"], shape: [4], broadcast_axes: [], measure_space: "data", value_kind: "size" },
    ],
  );
  assert.equal(typedIr.body.find(({ name }) => name === "emitter").type, "Layer");
  assert.equal(typedIr.body.find(({ name }) => name === "view").type, "View");
});

test("Frame add accepts Layer-local t_min and t_max instead of explicit t coordinates", () => {
  const source = temporalEmitterSource
    .replace("t: [0, 2.094395102, 4.188790205, 6.283185307]\n", "")
    .replace("t:t, t_mode", "t_min:0, t_max:6.283185307, t_mode");
  const typedIr = compile(source);
  const time = typedIr.ui_program.operations[1].time;
  assert.equal(time.axis, "t");
  assert.equal(time.sample_count, 4);
  assert.equal(time.min.value, 0);
  assert.equal(time.max.value, 6.283185307);
  assert.equal(time.mode.value, "repeat");
  assert.equal("coordinates" in time, false);
});

test("Frame add rejects an unknown Layer-local t_mode", () => {
  assert.throws(
    () => compile(temporalEmitterSource.replace('t_mode:"repeat"', 't_mode:"loop"')),
    /Frame\.add t_mode must be repeat, mirror, stop, or reset/u,
  );
});

test("approved Frame geometry calls lower to retained scene operations instead of no-ops", () => {
  const typedIr = compile(litSurfaceSource);
  assert.deepEqual(typedIr.ui_program.operations.map(({ kind }) => kind), [
    "add_frame",
    "set_geom_options",
    "add_camera",
    "add",
    "add",
  ]);
  const [addFrame, options, camera, emitter, add] = typedIr.ui_program.operations;
  assert.equal(addFrame.frame_id, 0);
  assert.deepEqual(options.properties.background.items.map(({ value }) => value), [0.015, 0.02, 0.035, 1]);
  assert.equal(options.properties.unified_renderer.value, true);
  assert.deepEqual(camera.properties.pos.items.map(({ value }) => value), [4, -6, 4.2]);
  assert.equal(emitter.properties.id.value, "key");
  assert.equal(emitter.properties.emission.type, "[num:3]");
  assert.equal(add.layer_id, 1);
  assert.equal(add.properties.id.value, "lit_surface");
  assert.equal(add.properties.color.type, "[num:4]");
  assert.equal(add.properties.receives_lighting.value, true);
  assert.equal(typedIr.body.find(({ name }) => name === "surface").type, "Layer");
});

test("Frame add stages rectangular surface grids without materializing a 2 by 2 limit", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const typedIr = compile(rectangularSurfaceSource);
  const root = path.join(workRoot, "rectangular-grid");
  const source = path.join(root, "rectangular-grid.vkf");
  const typedIrPath = path.join(root, "rectangular-grid.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(source, `${rectangularSurfaceSource}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const nativeSummary = JSON.parse(stage(nativeSceneStager, undefined, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...nativeSummary.page_rel.split("/"),
  ));
  const packets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));
  const mesh = packets[2].payload.display.geom.frame_0.meshes[0];
  assert.equal(mesh.vertices.length, 2 * 7 * 10);
  assert.equal(mesh.indices.length, 6 * (2 - 1) * (7 - 1));
  assert.deepEqual(mesh.indices.slice(0, 6), [0, 1, 8, 0, 8, 7]);
});

test("Frame add preserves spectral emission as wavelength and radiance vectors", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const typedIr = compile(spectralEmissionSource);
  const emission = typedIr.ui_program.operations.at(-1).properties.emission;
  assert.equal(emission.type, "record{wavelength:[int:3],radiance:[num:3]}");

  const root = path.join(workRoot, "spectral-emission");
  const source = path.join(root, "spectral-emission.vkf");
  const typedIrPath = path.join(root, "spectral-emission.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(source, `${spectralEmissionSource}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const nativeSummary = JSON.parse(stage(nativeSceneStager, undefined, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...nativeSummary.page_rel.split("/"),
  ));
  const packets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));
  assert.deepEqual(
    packets[2].payload.display.geom.frame_0.meshes[0].emission,
    {
      wavelength: [460, 550, 610],
      radiance: [0.2, 0.4, 0.8],
    },
  );
});

test("Frame add rejects spectral emission vectors with different lengths", () => {
  assert.throws(
    () => compile(spectralEmissionSource.replace(
      "radiance:[0.2, 0.4, 0.8]",
      "radiance:[0.2, 0.4]",
    )),
    /emission wavelength and radiance vectors must have the same nonzero length/u,
  );
});

test("Frame add accepts the existing three-component RGB convention as an emission shortcut", () => {
  const typedIr = compile(spectralEmissionSource.replace(
    "(wavelength:[460, 550, 610], radiance:[0.2, 0.4, 0.8])",
    "[2.0, 0.5, 0.25]",
  ));
  const emission = typedIr.ui_program.operations.at(-1).properties.emission;
  assert.equal(emission.type, "[num:3]");
  assert.deepEqual(emission.items.map(({ value }) => value), [2, 0.5, 0.25]);
});

test("Frame material emission does not alias physical emissivity", () => {
  assert.throws(
    () => compile(spectralEmissionSource.replace(
      "emission:(wavelength:[460, 550, 610], radiance:[0.2, 0.4, 0.8])",
      "emissivity:0.8",
    )),
    /Frame\.add does not support `emissivity`/u,
  );
});

test("Frame add stages flat x/y vectors as one constant-width 2D polyline", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const typedIr = compile(linePlotSource);
  const root = path.join(workRoot, "flat-line");
  const source = path.join(root, "flat-line.vkf");
  const typedIrPath = path.join(root, "flat-line.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(source, `${linePlotSource}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const nativeSummary = JSON.parse(stage(nativeSceneStager, undefined, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...nativeSummary.page_rel.split("/"),
  ));
  const packets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));
  const wasmSummary = JSON.parse(stage("vkf_wasm_artifact_smoke", undefined, [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [bytes, manifest] = await Promise.all([
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const wasmPackets = JSON.parse(
    runtimeBridge.instantiateWasmRuntime({ bytes, manifest })
      .readBinding("$ui$compiled$packets"),
  );
  assert.deepEqual(wasmPackets, packets);
  const mesh = packets[2].payload.display.geom.frame_0.meshes[0];
  assert.equal(mesh.topology, "line-list");
  assert.equal(mesh.render_mode, "line");
  assert.equal(mesh.marker_space, "pixel");
  assert.equal(mesh.mode3d, false);
  assert.equal(mesh.edge_width, 1);
  assert.equal(mesh.vertex_widths, undefined);
  assert.equal(mesh.vertices.length, 513 * 10);
  assert.equal(mesh.indices.length, 512 * 2);
  assert.deepEqual(mesh.indices.slice(0, 8), [0, 1, 1, 2, 2, 3, 3, 4]);
  assert.deepEqual(mesh.indices.slice(-8), [508, 509, 509, 510, 510, 511, 511, 512]);
  assert.deepEqual(
    mesh.vertices.filter((_, index) => index % 10 === 2),
    new Array(513).fill(0),
  );
});

test("Frame add broadcasts dense range axes into a smooth surface", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const typedIr = compile(rangeSurfaceSource);
  const root = path.join(workRoot, "range-surface");
  const source = path.join(root, "range-surface.vkf");
  const typedIrPath = path.join(root, "range-surface.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(source, `${rangeSurfaceSource}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const nativeSummary = JSON.parse(stage(nativeSceneStager, undefined, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...nativeSummary.page_rel.split("/"),
  ));
  const nativePackets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));
  const wasmSummary = JSON.parse(stage("vkf_wasm_artifact_smoke", undefined, [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [bytes, manifest] = await Promise.all([
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const wasmPackets = JSON.parse(
    runtimeBridge.instantiateWasmRuntime({ bytes, manifest })
      .readBinding("$ui$compiled$packets"),
  );
  assert.deepEqual(wasmPackets, nativePackets);
  const mesh = nativePackets[2].payload.display.geom.frame_0.meshes[0];
  assert.equal(mesh.topology, "triangle-list");
  assert.equal(mesh.vertices.length, 33 * 25 * 10);
  assert.equal(mesh.indices.length, 32 * 24 * 6);
});

test("native and WASM stage the same executable retained material scene", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const typedIr = compile(litSurfaceSource);
  const root = path.join(workRoot, "parity");
  const source = path.join(root, "lit-surface.vkf");
  const typedIrPath = path.join(root, "lit-surface.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(source, `${litSurfaceSource}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const nativeSummary = JSON.parse(stage(nativeSceneStager, undefined, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...nativeSummary.page_rel.split("/"),
  ));
  const nativePackets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));

  const wasmSummary = JSON.parse(stage("vkf_wasm_artifact_smoke", undefined, [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  const [bytes, manifest] = await Promise.all([
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes, manifest });
  const wasmPackets = JSON.parse(runtime.readBinding("$ui$compiled$packets"));
  assert.deepEqual(wasmPackets, nativePackets);

  assert.deepEqual(nativePackets.map(({ seq, kind }) => ({ seq, kind })), [
    { seq: 1, kind: "scene.replace" },
    { seq: 2, kind: "ui_state.replace" },
    { seq: 3, kind: "display.replace" },
  ]);
  const frame = nativePackets[0].payload.commands.find(
    ({ kind }) => kind === "frame_upsert",
  );
  assert.ok(frame, "retained scene packets must contain the Frame.add frame");
  assert.equal(frame.id, "frame_0");
  const geom = nativePackets[2].payload.display.geom.frame_0;
  assert.equal(geom.unified_renderer, true);
  assert.deepEqual(geom.background, [0.015, 0.02, 0.035, 1]);
  assert.deepEqual(geom.camera.pos, [4, -6, 4.2]);
  const emitter = geom.meshes.find(({ id }) => id === "key");
  const surface = geom.meshes.find(({ id }) => id === "lit_surface");
  assert.ok(emitter, "emissive Frame.add geometry must remain a scene object");
  assert.deepEqual(emitter.emission, [28, 25.76, 21.84]);
  assert.ok(surface, "lit Frame.add geometry must remain a scene object");
  assert.equal(surface.type, "field_mesh");
  assert.equal(surface.no_lighting, false);
  assert.equal(surface.casts_shadow, true);
  assert.equal(surface.indices.length, 6);
});

test("one retained artifact combines material geometry with static HTML and CSS controls", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const sourceText = `${litSurfaceSource}\n${[
    "controls: display.add_frame(pos:[0.78, 0.06], size:[0.18, 0.84])",
    'controls.load("ui/main.html")',
  ].join("\n")}`;
  const typedIr = compile(sourceText);
  const root = path.join(workRoot, "combined");
  const source = path.join(root, "gallery.vkf");
  const typedIrPath = path.join(root, "gallery.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  const html = '<link rel="stylesheet" href="theme.css"><nav><button id="glass">Glass</button><input id="opacity" type="range" min="0" max="1" step="0.05" value="0.5"></nav>';
  const css = "nav { display: grid; gap: 0.5rem; }\n";
  await Promise.all([
    mkdir(path.join(root, "ui"), { recursive: true }),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    writeFile(path.join(root, "ui", "main.html"), html, "utf8"),
    writeFile(path.join(root, "ui", "theme.css"), css, "utf8"),
  ]);

  const nativeSummary = JSON.parse(stage(nativeSceneStager, undefined, [
    "--source", source, "--overlay-web", overlayWeb, "--typed-ir", typedIrPath,
  ]));
  const nativeRoot = path.dirname(path.join(overlayWeb, ...nativeSummary.page_rel.split("/")));
  const wasmSummary = JSON.parse(stage("vkf_wasm_artifact_smoke", undefined, [
    "--source", source, "--typed-ir", typedIrPath,
  ]));
  const wasmRoot = path.dirname(wasmSummary.artifact_path);
  const [nativePackets, wasmPackets, nativeMounts, wasmMounts] = await Promise.all([
    readFile(path.join(nativeRoot, "vf-runtime-packets.json"), "utf8").then(JSON.parse),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse)
      .then(async (manifest) => {
        const bytes = await readFile(wasmSummary.artifact_path);
        return JSON.parse(runtimeBridge.instantiateWasmRuntime({ bytes, manifest })
          .readBinding("$ui$compiled$packets"));
      }),
    readFile(path.join(nativeRoot, "vf-static-html-loads.json"), "utf8").then(JSON.parse),
    readFile(path.join(wasmRoot, "vf-static-html-loads.json"), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(nativePackets, wasmPackets);
  assert.deepEqual(nativePackets[0].payload.commands.map(({ id }) => id), ["frame_0", "frame_1"]);
  assert.deepEqual(Object.keys(nativePackets[2].payload.display.geom), ["frame_0"]);
  assert.deepEqual(nativeMounts, wasmMounts);
  assert.equal(nativeMounts[0].frame_id, "frame_1");
  assert.equal(
    await readFile(path.join(nativeRoot, ...nativeMounts[0].resource.split("/")), "utf8"),
    html,
  );
  assert.equal(
    await readFile(path.join(wasmRoot, ...wasmMounts[0].resource.split("/")), "utf8"),
    html,
  );
});
