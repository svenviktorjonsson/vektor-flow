import assert from "node:assert/strict";
import {
  after,
  test,
} from "node:test";
import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const workRoot = path.join(repositoryRoot, ".work", `u12-world-${process.pid}`);

after(async () => {
  await rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

function executable(directory, name) {
  assert.ok(directory, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(directory, process.platform === "win32" ? `${name}.exe` : name);
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

function runFailure(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(result.status, 0, "invalid typed World presentation unexpectedly staged");
  return `${result.stdout}\n${result.stderr}`;
}

function compileSource(source) {
  const normalized = source.replace(/\r\n/gu, "\n");
  const tokens = run(executable(nativeBin, "vkf_lexer_cursor_smoke"), [normalized]);
  const ast = run(executable(nativeBin, "vkf_parser_token_stream_smoke"), [], tokens);
  return JSON.parse(run(executable(nativeBin, "vkf_ast_to_ir_smoke"), [], ast));
}

test("native stager consumes the canonical typed World presentation", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  await mkdir(workRoot, { recursive: true });
  const sourceText = await readFile(
    path.join(repositoryRoot, "examples", "115_world_embedding_native.vkf"),
    "utf8",
  );
  assert.doesNotMatch(sourceText, /native_scene_config_path/u);
  const typedIr = compileSource(sourceText);

  const source = path.join(workRoot, "world.vkf");
  const typedIrPath = path.join(workRoot, "world.typed-ir.json");
  const overlayWeb = path.join(workRoot, "vf-ui");
  await Promise.all([
    writeFile(source, sourceText, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const staged = JSON.parse(run(nativeSceneStager, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  assert.equal(staged.scene_config_source, "vkf-world-ui-program-lowering");
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...staged.page_rel.split("/"),
  ));
  const [packets, manifest] = await Promise.all([
    readFile(path.join(sessionDirectory, "vf-runtime-packets.json"), "utf8").then(JSON.parse),
    readFile(staged.manifest_path, "utf8").then(JSON.parse),
  ]);
  assert.equal(manifest.scene_config_source, "vkf-world-ui-program-lowering");
  assert.equal(manifest.runtime_packets_source, "vkf-world-ui-program-lowering");
  assert.deepEqual(packets.map(({ seq, kind }) => ({ seq, kind })), [
    { seq: 1, kind: "scene.replace" },
    { seq: 2, kind: "ui_state.replace" },
    { seq: 3, kind: "display.replace" },
  ]);
  const frame = packets[0].payload.commands[0];
  assert.equal(frame.kind, "frame_upsert");
  assert.equal(frame.id, "world_0_view_0");
  const geom = packets[2].payload.display.geom.world_0_view_0;
  assert.equal(geom.frame, "world_0_view_0");
  assert.deepEqual(geom.meshes, [{
    type: "field_mesh",
    id: "world_0_layer_0",
    topology: "point-list",
    render_mode: "marker_impostor",
    marker_space: "world",
    mode3d: false,
    vertices: [0, 1, 0, 0, 0, 1, 1, 0, 0, 1],
    indices: [0],
    vertex_size: 4,
    depth_write: false,
    no_lighting: true,
    pickable: true,
    layer_id: 0,
  }]);
});

test("native stager rejects unsupported World effects before writing artifacts", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const invalidRoot = path.join(workRoot, "invalid-effects");
  await mkdir(invalidRoot, { recursive: true });
  const sourceText = await readFile(
    path.join(repositoryRoot, "examples", "115_world_embedding_native.vkf"),
    "utf8",
  );
  const typedIr = compileSource(sourceText);
  typedIr.__vf_internal_world.worlds[0].gravity = true;
  const source = path.join(invalidRoot, "world-invalid.vkf");
  const typedIrPath = path.join(invalidRoot, "world-invalid.typed-ir.json");
  const overlayWeb = path.join(invalidRoot, "vf-ui");
  await Promise.all([
    writeFile(source, sourceText, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
  ]);

  const diagnostic = runFailure(nativeSceneStager, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]);
  assert.match(diagnostic, /requires `gravity:false`/u);
  await assert.rejects(readFile(path.join(invalidRoot, ".vkfbuild", "world-invalid.manifest.json")));
  await assert.rejects(readFile(path.join(overlayWeb, "sessions", "world-invalid", "vf-runtime-packets.json")));
});
