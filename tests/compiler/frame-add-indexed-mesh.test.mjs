import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const workRoot = path.join(repositoryRoot, ".w", `indexed-mesh-${process.pid}`);

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

const indexedEmitterSource = [
  ": .ui.display",
  "display: Display(dim:2)",
  "frame: display.add_frame(pos:[0.04, 0.06], size:[0.72, 0.84])",
  "p: [[-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]",
  "faces: [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]]",
  "mesh: frame.add(p_uc:p, faces_uvw:faces, id:\"emitter\", color:[0.2, 0.3, 0.4, 1], emission:(wavelength:[530, 630], radiance:[2, 5]), roughness:0.35, reflectivity:0.2, casts_shadow:true)",
  "view: frame.push()",
].join("\n");

test("Frame add compiles one indexed emissive mesh through add and push", () => {
  const typedIr = compile(indexedEmitterSource);
  assert.deepEqual(typedIr.ui_program.operations.map(({ kind }) => kind), [
    "add_frame",
    "add",
    "push",
  ]);
  const add = typedIr.ui_program.operations[1];
  assert.equal(add.properties.p_uc.type, "[[int:3]:4]");
  assert.equal(add.properties.faces_uvw.type, "[[int:3]:4]");
  assert.equal(add.properties.emission.type, "record{wavelength:[int:2],radiance:[int:2]}");
  assert.equal(add.properties.roughness.value, 0.35);
  assert.equal(add.properties.reflectivity.value, 0.2);
  assert.equal(add.properties.casts_shadow.value, true);
  assert.equal(typedIr.body.find(({ name }) => name === "mesh").type, "Layer");
  assert.equal(typedIr.body.find(({ name }) => name === "view").type, "View");
});

test("Frame push retains one indexed emissive mesh without a separate light", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager executable");
  const typedIr = compile(indexedEmitterSource);
  const root = path.join(workRoot, "emitter");
  const source = path.join(root, "emitter.vkf");
  const typedIrPath = path.join(root, "emitter.typed-ir.json");
  const overlayWeb = path.join(root, "vf-ui");
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(source, `${indexedEmitterSource}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
    cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true }),
  ]);

  const summary = JSON.parse(stage(nativeSceneStager, undefined, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(
    overlayWeb,
    ...summary.page_rel.split("/"),
  ));
  const packets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));
  const scene = packets[2].payload.display.geom.frame_0;
  assert.equal(scene.lights.length, 0);
  assert.equal(scene.meshes.length, 1);
  const mesh = scene.meshes[0];
  assert.equal(mesh.id, "emitter");
  assert.equal(mesh.topology, "triangle-list");
  assert.equal(mesh.vertices.length, 4 * 10);
  assert.deepEqual(mesh.indices, [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0]);
  assert.deepEqual(mesh.emission.wavelength, [530, 630]);
  assert.deepEqual(mesh.emission.radiance, [2, 5]);
  assert.equal(mesh.roughness, 0.35);
  assert.equal(mesh.reflectivity, 0.2);
  assert.equal(mesh.casts_shadow, true);
});
