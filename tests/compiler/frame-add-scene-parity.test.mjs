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
  "frame.add_light(id:\"key\", pos:[2.5, -3.0, 4.5], target:[0.0, 0.5, 0.0], color:[1.0, 0.92, 0.78, 1.0], intensity:28.0, range:16.0, casts_shadow:true)",
  "surface: frame.add(x:[[-1.5, 1.5], [-1.5, 1.5]], y:[[0.0, 0.0], [2.0, 2.0]], z:[[0.0, 0.0], [0.0, 0.0]], id:\"lit_surface\", color:[0.16, 0.52, 0.92, 1.0], representation:\"faces\", receives_lighting:true, casts_shadow:true)",
].join("\n");

const rectangularSurfaceSource = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
  "surface: frame.add(x:[[-3, -2, -1, 0, 1, 2, 3], [-3, -2, -1, 0, 1, 2, 3]], y:[[-0.12, -0.92, -0.86, -0.03, 0.82, 0.88, 0.09], [-0.06, -0.86, -0.80, 0.03, 0.88, 0.94, 0.15]], z:[[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]], id:\"sine\", color:[0.12, 0.72, 1.0, 1.0])",
].join("\n");

const linePlotSource = [
  ": .ui.display",
  "math:.math",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.08, 0.08], size:[0.84, 0.84])",
  "x: [..512] / 512 * 2 * math.pi - math.pi",
  "line: frame.add(x:x, y:math.sin(x), id:\"sine\", color:[0.12, 0.72, 1.0, 1.0])",
].join("\n");

test("approved Frame add calls lower to retained scene operations instead of no-ops", () => {
  const typedIr = compile(litSurfaceSource);
  assert.deepEqual(typedIr.ui_program.operations.map(({ kind }) => kind), [
    "add_frame",
    "set_geom_options",
    "add_camera",
    "add_light",
    "add",
  ]);
  const [addFrame, options, camera, light, add] = typedIr.ui_program.operations;
  assert.equal(addFrame.frame_id, 0);
  assert.deepEqual(options.properties.background.items.map(({ value }) => value), [0.015, 0.02, 0.035, 1]);
  assert.equal(options.properties.unified_renderer.value, true);
  assert.deepEqual(camera.properties.pos.items.map(({ value }) => value), [4, -6, 4.2]);
  assert.equal(light.properties.id.value, "key");
  assert.equal(light.properties.casts_shadow.value, true);
  assert.equal(add.layer_id, 0);
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
  const frame = nativePackets[0].payload.commands[0];
  assert.equal(frame.id, "frame_0");
  const geom = nativePackets[2].payload.display.geom.frame_0;
  assert.equal(geom.unified_renderer, true);
  assert.deepEqual(geom.background, [0.015, 0.02, 0.035, 1]);
  assert.deepEqual(geom.camera.pos, [4, -6, 4.2]);
  assert.equal(geom.lights[0].id, "key");
  assert.equal(geom.meshes[0].id, "lit_surface");
  assert.equal(geom.meshes[0].type, "field_mesh");
  assert.equal(geom.meshes[0].no_lighting, false);
  assert.equal(geom.meshes[0].casts_shadow, true);
  assert.equal(geom.meshes[0].indices.length, 6);
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
