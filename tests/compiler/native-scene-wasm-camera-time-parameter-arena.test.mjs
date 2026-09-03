import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const work = path.join(repositoryRoot, ".w", `camera-time-arena-${process.pid}`);
let artifactDirectory;

after(async () => {
  await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  if (artifactDirectory) {
    await rm(artifactDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
});

function tool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN is required");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(name, args = [], input) {
  const result = spawnSync(tool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed`);
  return result.stdout;
}

function cameraField(runtime, fieldName) {
  const arena = runtime.renderParameterArena();
  const section = arena.descriptor.sections.find(({ name }) => name === "camera");
  const field = section.fields.find(({ name }) => name === fieldName);
  return new Float32Array(
    arena.bytes.buffer,
    arena.bytes.byteOffset + section.byte_offset + field.byte_offset,
    field.components,
  );
}

test("Frame.add_camera p_t updates the shared camera parameter record", async () => {
  await mkdir(work, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.05, 0.05], size:[0.9, 0.9])",
    "t: [0, 2]",
    "camera_p: [[0, 2, -4], [2, 2, -4]]",
    "frame.add_camera(p_t:camera_p, target:[0, 1, 0], up:[0, 1, 0], fov:43, t:t, t_mode:\"repeat\")",
    "triangle: frame.add(id:\"triangle\", p_uc:[[-1, 0, 0], [1, 0, 0], [0, 2, 0]], faces_uvw:[[0, 1, 2]], color:[1, 1, 1, 1])",
    "view: frame.push()",
  ].join("\n");
  const source = path.join(work, "camera-time.vkf");
  const typedIrPath = path.join(work, "camera-time.typed-ir.json");
  await writeFile(source, sourceText, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [sourceText]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const typedIrText = run("vkf_ast_to_ir_smoke", [], ast);
  const typedIr = JSON.parse(typedIrText);
  const cameraOperation = typedIr.ui_program.operations.find(
    ({ kind }) => kind === "add_camera",
  );
  assert.equal(cameraOperation.time.sample_count, 2);
  assert.deepEqual(
    cameraOperation.channels.map(({ name }) => name),
    ["p"],
  );
  await writeFile(typedIrPath, typedIrText, "utf8");

  const summary = JSON.parse(run("vkf_wasm_artifact_smoke", [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  artifactDirectory = path.dirname(summary.artifact_path);
  const [wasm, manifest] = await Promise.all([
    readFile(summary.artifact_path),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtimeBridge = await import("../../web/vf-ui/vf-compiled-runtime-bridge.js");
  const runtime = runtimeBridge.default.instantiateWasmRuntime({ bytes: wasm, manifest });

  assert.deepEqual(
    manifest.runtime_surface.temporal_playback.changed_parameter_sections,
    ["camera"],
  );
  runtime.init();
  const position = cameraField(runtime, "position");
  const target = cameraField(runtime, "target");
  assert.deepEqual([...position], [0, 2, -4]);
  assert.deepEqual([...target], [0, 1, 0]);

  runtime.update();
  assert.deepEqual([...position], [1, 2, -4]);
  assert.deepEqual([...target], [0, 1, 0], "a static target stays fixed");
  runtime.update();
  assert.deepEqual([...position], [2, 2, -4]);
  runtime.update();
  assert.deepEqual([...position], [1, 2, -4], "repeat closes smoothly");
  runtime.update();
  assert.deepEqual([...position], [0, 2, -4]);

  const interactive = runtimeBridge.default.instantiateWasmRuntime({ bytes: wasm, manifest });
  interactive.init();
  interactive.update();
  const interactivePosition = cameraField(interactive, "position");
  const animatedBeforeControl = [1, 2, -4];
  interactive.cameraControl(1, 0, 0);
  const controlledPosition = [...interactivePosition];
  const controlDelta = controlledPosition.map(
    (value, index) => value - animatedBeforeControl[index],
  );
  interactive.update();
  assert.deepEqual(
    [...interactivePosition].map((value) => Number(value.toFixed(6))),
    [2, 2, -4].map((value, index) =>
      Number((value + controlDelta[index]).toFixed(6))),
    "camera animation must preserve interactive orbit input instead of snapping back",
  );
});

test("Frame.add_camera component _t channels reuse the position record", async () => {
  await mkdir(work, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.05, 0.05], size:[0.9, 0.9])",
    "t: [0, 2]",
    "camera_x: [0, 2]",
    "camera_y: [2, 4]",
    "frame.add_camera(p:[0, 2, -4], x_t:camera_x, y_t:camera_y, target:[0, 1, 0], up:[0, 1, 0], fov:43, t:t, t_mode:\"repeat\")",
    "triangle: frame.add(id:\"triangle\", p_uc:[[-1, 0, 0], [1, 0, 0], [0, 2, 0]], faces_uvw:[[0, 1, 2]], color:[1, 1, 1, 1])",
    "view: frame.push()",
  ].join("\n");
  const source = path.join(work, "camera-components.vkf");
  const typedIrPath = path.join(work, "camera-components.typed-ir.json");
  await writeFile(source, sourceText, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [sourceText]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const typedIrText = run("vkf_ast_to_ir_smoke", [], ast);
  const typedIr = JSON.parse(typedIrText);
  const cameraOperation = typedIr.ui_program.operations.find(
    ({ kind }) => kind === "add_camera",
  );
  assert.deepEqual(
    cameraOperation.channels.map(({ name }) => name),
    ["x", "y"],
  );
  await writeFile(typedIrPath, typedIrText, "utf8");

  const summary = JSON.parse(run("vkf_wasm_artifact_smoke", [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  artifactDirectory = path.dirname(summary.artifact_path);
  const [wasm, manifest] = await Promise.all([
    readFile(summary.artifact_path),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtimeBridge = await import("../../web/vf-ui/vf-compiled-runtime-bridge.js");
  const runtime = runtimeBridge.default.instantiateWasmRuntime({ bytes: wasm, manifest });
  runtime.init();
  const position = cameraField(runtime, "position");
  assert.deepEqual([...position], [0, 2, -4]);
  runtime.update();
  assert.deepEqual([...position], [1, 3, -4]);
  runtime.update();
  assert.deepEqual([...position], [2, 4, -4]);
  runtime.update();
  assert.deepEqual([...position], [1, 3, -4]);
  runtime.update();
  assert.deepEqual([...position], [0, 2, -4]);
});

test("Frame.add_camera target_t and fov_t use the same temporal path", async () => {
  await mkdir(work, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.05, 0.05], size:[0.9, 0.9])",
    "t: [0, 2]",
    "camera_target: [[0, 1, 0], [0, 2, 0]]",
    "camera_fov: [40, 44]",
    "frame.add_camera(p:[0, 2, -4], target_t:camera_target, up:[0, 1, 0], fov_t:camera_fov, t:t, t_mode:\"repeat\")",
    "triangle: frame.add(id:\"triangle\", p_uc:[[-1, 0, 0], [1, 0, 0], [0, 2, 0]], faces_uvw:[[0, 1, 2]], color:[1, 1, 1, 1])",
    "view: frame.push()",
  ].join("\n");
  const source = path.join(work, "camera-properties.vkf");
  const typedIrPath = path.join(work, "camera-properties.typed-ir.json");
  await writeFile(source, sourceText, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [sourceText]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const typedIrText = run("vkf_ast_to_ir_smoke", [], ast);
  const typedIr = JSON.parse(typedIrText);
  const cameraOperation = typedIr.ui_program.operations.find(
    ({ kind }) => kind === "add_camera",
  );
  assert.deepEqual(
    cameraOperation.channels.map(({ name }) => name),
    ["target", "fov"],
  );
  await writeFile(typedIrPath, typedIrText, "utf8");

  const summary = JSON.parse(run("vkf_wasm_artifact_smoke", [
    "--source", source,
    "--typed-ir", typedIrPath,
  ]));
  artifactDirectory = path.dirname(summary.artifact_path);
  const [wasm, manifest] = await Promise.all([
    readFile(summary.artifact_path),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtimeBridge = await import("../../web/vf-ui/vf-compiled-runtime-bridge.js");
  const runtime = runtimeBridge.default.instantiateWasmRuntime({ bytes: wasm, manifest });
  runtime.init();
  const position = cameraField(runtime, "position");
  const target = cameraField(runtime, "target");
  const fov = cameraField(runtime, "fov_y_degrees");
  assert.deepEqual([...position], [0, 2, -4]);
  assert.deepEqual([...target], [0, 1, 0]);
  assert.deepEqual([...fov], [40]);
  runtime.update();
  assert.deepEqual([...position], [0, 2, -4]);
  assert.deepEqual([...target], [0, 1.5, 0]);
  assert.deepEqual([...fov], [42]);
});
