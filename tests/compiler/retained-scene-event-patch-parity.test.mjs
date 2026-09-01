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
const workRoot = path.join(repositoryRoot, ".w", `g01n-events-${process.pid}`);

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

const sourceText = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.04, 0.06], size:[0.72, 0.84])",
  "frame.add_camera(pos:[4.0, -6.0, 4.2], target:[0.0, 0.8, 0.4])",
  "glass: frame.add(x:[[-1.5, 1.5], [-1.5, 1.5]], y:[[0.0, 0.0], [2.0, 2.0]], z:[[0.0, 0.0], [0.0, 0.0]], id:\"glass\", color:[0.28, 0.82, 0.94, 0.5], alpha:0.5, transparent:true)",
  "controls: display.add_frame(pos:[0.78, 0.06], size:[0.18, 0.84])",
  'controls.load("ui/main.html")',
  'show_glass: Button(id:"show-glass")',
  'opacity: Input(id:"opacity")',
  "(event: show_glass.events.get())??>",
  "    ButtonClicked =>",
  "        glass.visible: true",
  "(slider_event: opacity.events.get())??>",
  "    SliderValueChanged =>",
  "        glass.alpha: slider_event.value",
].join("\n");

test("compiled Button and Slider arms export identical retained layer patches", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const typedIr = compile(sourceText);
  const loops = typedIr.body
    .filter(({ kind, expr }) => kind === "expr_stmt" && expr?.kind === "ui_owner_event_loop")
    .map(({ expr }) => expr);
  assert.equal(loops.length, 2);
  assert.deepEqual(loops.map(({ arms }) => arms[0].body.body[0].kind), ["update_attr", "update_attr"]);

  const root = path.join(workRoot, "artifact");
  const source = path.join(root, "gallery.vkf");
  const typedIrPath = path.join(root, "gallery.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await Promise.all([
    mkdir(path.join(root, "ui"), { recursive: true }),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    writeFile(path.join(root, "ui", "main.html"), '<button id="show-glass">Glass</button><input id="opacity" type="range" min="0" max="1" value="0.5">', "utf8"),
  ]);

  const nativeSummary = JSON.parse(run(nativeSceneStager, [
    "--source", source, "--overlay-web", overlayWeb, "--typed-ir", typedIrPath,
  ]));
  const nativeRoot = path.dirname(path.join(overlayWeb, ...nativeSummary.page_rel.split("/")));
  const nativeProgram = JSON.parse(await readFile(path.join(nativeRoot, "vf-event-program.json"), "utf8"));

  const wasmSummary = JSON.parse(run(executable("vkf_wasm_artifact_smoke"), [
    "--source", source, "--typed-ir", typedIrPath,
  ]));
  const [bytes, manifest] = await Promise.all([
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const wasmProgram = JSON.parse(runtimeBridge.instantiateWasmRuntime({ bytes, manifest })
    .readBinding("$ui$compiled$event_program"));
  assert.deepEqual(wasmProgram, nativeProgram);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(path.dirname(wasmSummary.artifact_path), "vf-event-program.json"), "utf8")),
    nativeProgram,
  );
  assert.equal(nativeProgram.schema, "vektor-flow/retained-event-program");
  assert.deepEqual(nativeProgram.rules.map(({ event, widget_id: widgetId }) => ({ event, widgetId })), [
    { event: "ButtonClicked", widgetId: "show-glass" },
    { event: "SliderValueChanged", widgetId: "opacity" },
  ]);
  assert.deepEqual(nativeProgram.rules.map(({ actions }) => actions[0].state.property), [
    "visible",
    "alpha",
  ]);
  assert.deepEqual(nativeProgram.rules[1].actions[0].state.value, {
    kind: "event_field",
    field: "value",
  });

  const execution = runtimeContract.createInternalRetainedEventProgramExecution(wasmProgram);
  const buttonPacket = execution.dispatch({
    event: "ButtonClicked",
    widget_id: "show-glass",
    frame_id: "frame_1",
  });
  assert.equal(buttonPacket.kind, "display.replace");
  assert.equal(buttonPacket.payload.display.geom.frame_0.meshes[0].visible, true);
  const sliderPacket = execution.dispatch({
    event: "SliderValueChanged",
    widget_id: "opacity",
    frame_id: "frame_1",
    value: 0.72,
  });
  assert.equal(sliderPacket.payload.display.geom.frame_0.meshes[0].alpha, 0.72);
  assert.equal(sliderPacket.payload.display.geom.frame_0.meshes[0].visible, true);
});
