import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const require = createRequire(import.meta.url);
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const work = path.join(repositoryRoot, ".w", `layer-time-arena-${process.pid}`);
let compilerRuns = 0;
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
  compilerRuns += 1;
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

function sectionRecord(arena, sectionName, entryId, fieldName) {
  const section = arena.descriptor.sections.find(({ name }) => name === sectionName);
  assert.ok(section, `missing ${sectionName} parameter section`);
  const entry = section.entries.find(({ id }) => id === entryId);
  assert.ok(entry, `missing ${entryId} in ${sectionName} parameter section`);
  const field = section.fields.find(({ name }) => name === fieldName);
  assert.ok(field, `missing ${fieldName} in ${sectionName} parameter section`);
  const offset = section.byte_offset + entry.index * section.stride + field.byte_offset;
  return new Float32Array(
    arena.bytes.buffer,
    arena.bytes.byteOffset + offset,
    field.components,
  );
}

test("two opposite emissive p_t Layers update only parameters", async () => {
  await mkdir(work, { recursive: true });
  const sourceText = [
    ": .ui.display",
    "display: Display(dim:2)",
    "frame: display.add_frame(pos:[0.05, 0.05], size:[0.9, 0.9])",
    "t: [0, 2]",
    "left_p: [[-2, 0, 0], [-1, 0, 0]]",
    "right_p: [[2, 0, 0], [1, 0, 0]]",
    "left: frame.add(p_t:left_p, c_tc:[[1, 0.2, 0.1, 1], [1, 0.2, 0.1, 1]], s_t:[0.25, 0.25], t:t, t_mode:\"repeat\", s_mode:data, id:\"left_emitter\", emission:[8, 1, 0.5])",
    "right: frame.add(p_t:right_p, c_tc:[[0.1, 1, 0.2, 1], [0.1, 1, 0.2, 1]], s_t:[0.25, 0.25], t:t, t_mode:\"repeat\", s_mode:data, id:\"right_emitter\", emission:[0.5, 8, 1])",
    "view: frame.push()",
  ].join("\n");
  const source = path.join(work, `layer-time-public-${process.pid}.vkf`);
  const typedIrPath = path.join(work, "layer-time.typed-ir.json");
  await writeFile(source, sourceText, "utf8");
  const tokens = run("vkf_lexer_cursor_smoke", [sourceText]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const typedIrText = run("vkf_ast_to_ir_smoke", [], ast);
  const typedIr = JSON.parse(typedIrText);
  const temporalAdds = typedIr.ui_program.operations.filter(({ time }) => time);
  assert.equal(temporalAdds.length, 2);
  assert.deepEqual(
    temporalAdds.map(({ properties }) => properties.emission.items.map(({ value }) => value)),
    [[8, 1, 0.5], [0.5, 8, 1]],
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
  assert.equal(compilerRuns, 4, "one compiler pipeline must produce the runtime");

  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes: wasm, manifest });
  runtime.init();
  const parameters = runtime.renderParameterArena();
  const topology = runtime.retainedSceneArena();
  assert.ok(parameters,
    `temporal Layers must expose the render parameter arena; runtime surface: ${JSON.stringify(manifest.runtime_surface)}`);
  assert.ok(topology, "temporal Layers must retain one topology arena");
  const topologyBefore = Uint8Array.from(topology.bytes);
  const topologyAdapter = runtimeBridge.createRetainedSceneArenaAdapter(topology);
  const leftVertices = topologyAdapter.mesh("left_emitter").vertices;
  const rightVertices = topologyAdapter.mesh("right_emitter").vertices;
  const descriptorBefore = structuredClone(parameters.descriptor);
  const parameterPointer = parameters.byteOffset;
  const parameterLength = parameters.byteLength;

  const leftCenter = sectionRecord(parameters, "objects", "left_emitter", "center");
  const rightCenter = sectionRecord(parameters, "objects", "right_emitter", "center");
  const leftLight = sectionRecord(parameters, "lights", "left_emitter", "position");
  const rightLight = sectionRecord(parameters, "lights", "right_emitter", "position");
  assert.deepEqual([...leftVertices.subarray(0, 3)], [-2, 0, 0]);
  assert.deepEqual([...rightVertices.subarray(0, 3)], [2, 0, 0]);
  assert.deepEqual([...leftCenter], [0, 0, 0]);
  assert.deepEqual([...rightCenter], [0, 0, 0]);
  assert.deepEqual([...leftLight], [-2, 0, 0]);
  assert.deepEqual([...rightLight], [2, 0, 0]);

  runtime.update();
  assert.deepEqual([...leftCenter], [0.5, 0, 0]);
  assert.deepEqual([...rightCenter], [-0.5, 0, 0]);
  assert.deepEqual(
    [...leftVertices.subarray(0, 3)].map((value, index) => value + leftCenter[index]),
    [-1.5, 0, 0],
  );
  assert.deepEqual(
    [...rightVertices.subarray(0, 3)].map((value, index) => value + rightCenter[index]),
    [1.5, 0, 0],
  );
  assert.deepEqual([...leftLight], [-1.5, 0, 0]);
  assert.deepEqual([...rightLight], [1.5, 0, 0]);

  const parametersAfter = runtime.renderParameterArena();
  const topologyAfter = runtime.retainedSceneArena();
  assert.equal(parametersAfter.byteOffset, parameterPointer);
  assert.equal(parametersAfter.byteLength, parameterLength);
  assert.deepEqual(parametersAfter.descriptor, descriptorBefore);
  assert.deepEqual(topologyAfter.bytes, topologyBefore,
    "position playback must not rebuild or reupload topology");
  assert.equal(compilerRuns, 4, "playback must not re-enter the compiler");
});
