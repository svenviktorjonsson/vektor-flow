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
const runtimeContract = require("../../web/vf-ui/vf-runtime-packet-contract.js");
const galleryRoot = path.join(repositoryRoot, "examples", "material_ui_gallery");
const workRoot = path.join(repositoryRoot, ".w", `g01n-gallery-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function executable(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args = [], input) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed without diagnostics`);
  return result.stdout;
}

function compile(source) {
  const tokens = run(executable("vkf_lexer_cursor_smoke"), [source]);
  const ast = run(executable("vkf_parser_token_stream_smoke"), [], tokens);
  return JSON.parse(run(executable("vkf_ast_to_ir_smoke"), [], ast));
}

test("material UI gallery is one executable VKF scene with script-free HTML/CSS controls", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const [sourceText, html, css] = await Promise.all([
    readFile(path.join(galleryRoot, "app.vkf"), "utf8"),
    readFile(path.join(galleryRoot, "ui", "main.html"), "utf8"),
    readFile(path.join(galleryRoot, "ui", "gallery.css"), "utf8"),
  ]);
  assert.doesNotMatch(html, /<script|\son[a-z]+\s*=/iu);
  assert.match(html, /id="view-all"/u);
  assert.match(html, /id="glass-alpha"[^>]*type="range"/u);
  assert.match(css, /\.gallery-controls/u);

  const typedIr = compile(sourceText);
  const operationKinds = typedIr.ui_program.operations.map(({ kind }) => kind);
  assert.equal(operationKinds.filter((kind) => kind === "add").length, 5);
  assert.equal(operationKinds.filter((kind) => kind === "add_light").length, 3);
  assert.equal(operationKinds.filter((kind) => kind === "load").length, 1);
  const root = path.join(workRoot, "artifact");
  const source = path.join(root, "app.vkf");
  const typedIrPath = path.join(root, "app.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await cp(galleryRoot, root, { recursive: true });
  await cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true });
  await writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8");

  const nativeSummary = JSON.parse(run(nativeSceneStager, [
    "--source", source, "--overlay-web", overlayWeb, "--typed-ir", typedIrPath,
  ]));
  const nativeRoot = path.dirname(path.join(overlayWeb, ...nativeSummary.page_rel.split("/")));
  const wasmSummary = JSON.parse(run(executable("vkf_wasm_artifact_smoke"), [
    "--source", source, "--typed-ir", typedIrPath,
  ]));
  const [nativePackets, nativeProgram, bytes, manifest] = await Promise.all([
    readFile(path.join(nativeRoot, "vf-runtime-packets.json"), "utf8").then(JSON.parse),
    readFile(path.join(nativeRoot, "vf-event-program.json"), "utf8").then(JSON.parse),
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes, manifest });
  assert.deepEqual(JSON.parse(runtime.readBinding("$ui$compiled$packets")), nativePackets);
  assert.deepEqual(JSON.parse(runtime.readBinding("$ui$compiled$event_program")), nativeProgram);

  const scene = nativePackets[2].payload.display.geom.frame_0;
  const meshes = Object.fromEntries(scene.meshes.map((mesh) => [mesh.id, mesh]));
  assert.equal(meshes.studio_floor.texture.kind, "checker");
  assert.equal(meshes.mirror_wall.surface_system.kind, "screen");
  assert.equal(meshes.glass_panel.transparent, true);
  assert.equal(meshes.glass_panel.alpha, 0.08);
  assert.equal(meshes.sculpture_panel.casts_shadow, true);
  assert.equal(meshes.studio_floor.receives_shadow, true);
  assert.equal(scene.lights.filter(({ casts_shadow: castsShadow }) => castsShadow).length, 2);
  assert.deepEqual(nativeProgram.rules.map(({ event, widget_id: widgetId }) => `${event}:${widgetId}`), [
    "ButtonClicked:view-lighting",
    "ButtonClicked:view-mirror",
    "ButtonClicked:view-glass",
    "ButtonClicked:view-all",
    "SliderValueChanged:glass-alpha",
  ]);

  const events = runtimeContract.createInternalRetainedEventProgramExecution(nativeProgram);
  const mirror = events.dispatch({ event: "ButtonClicked", widget_id: "view-mirror" });
  assert.equal(mirror.payload.display.geom.frame_0.meshes.find(({ id }) => id === "mirror_wall").alpha, 1);
  const alpha = events.dispatch({ event: "SliderValueChanged", widget_id: "glass-alpha", value: 0.64 });
  assert.equal(alpha.payload.display.geom.frame_0.meshes.find(({ id }) => id === "glass_panel").alpha, 0.64);
});
