import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function stage(name, input, args = []) {
  const result = spawnSync(compilerTool(name), args, {
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
