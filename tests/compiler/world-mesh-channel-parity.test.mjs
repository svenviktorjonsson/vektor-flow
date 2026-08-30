import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const nativeSceneStager = process.env.VKF_NATIVE_SCENE_STAGER;
const wasmArtifact = process.env.VKF_WASM_ARTIFACT;
const workRoot = path.join(repositoryRoot, ".work", `u16a-mesh-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function run(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
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
  assert.notEqual(result.status, 0, "invalid mesh channels unexpectedly produced an artifact");
  return `${result.stdout}\n${result.stderr}`;
}

function numericList(values) {
  return {
    kind: "list",
    items: values.map((value) => ({ kind: "const", value })),
  };
}

function meshWorldTypedIr({ topology = [0, 1, 2] } = {}) {
  return {
    kind: "module",
    body: [],
    __vf_internal_world: {
      version: 1,
      worlds: [{
        id: 0,
        dimension: 3,
        em: false,
        gravity: false,
        rigid_collisions: false,
      }],
      operations: [{
        kind: "add",
        world_id: 0,
        object_id: 0,
        object_type: "Piece",
      }],
    },
    ui_program: {
      schema: "vektor-flow/ui-program",
      version: 1,
      operations: [{
        kind: "add",
        source: {
          kind: "world_embedding",
          world_id: 0,
          object_id: 0,
          object_type: "Piece",
        },
        channels: [
          { name: "positions", value: numericList([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
          { name: "topology", value: numericList(topology) },
          { name: "color", value: numericList([0.8, 0.7, 0.6, 1]) },
          { name: "material", value: numericList([7]) },
        ],
      }, { kind: "push" }, { kind: "show" }],
    },
  };
}

async function writeOracle(root, typedIr) {
  await mkdir(root, { recursive: true });
  const source = path.join(root, "mesh-world.vkf");
  const typedIrPath = path.join(root, "mesh-world.typed-ir.json");
  await Promise.all([
    writeFile(source, "# private typed-IR mesh consumer oracle\n", "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
  ]);
  return { source, typedIrPath };
}

test("native and WASM consume identical vector-first World mesh channels", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager");
  assert.ok(wasmArtifact, "VKF_WASM_ARTIFACT must name the focused WASM emitter");
  const root = path.join(workRoot, "valid");
  const overlayWeb = path.join(root, "vf-ui");
  const { source, typedIrPath } = await writeOracle(root, meshWorldTypedIr());
  await cp(path.join(repositoryRoot, "web", "vf-ui"), overlayWeb, { recursive: true });

  const staged = JSON.parse(run(nativeSceneStager, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]));
  const sessionDirectory = path.dirname(path.join(overlayWeb, ...staged.page_rel.split("/")));
  const nativePackets = JSON.parse(await readFile(
    path.join(sessionDirectory, "vf-runtime-packets.json"),
    "utf8",
  ));
  const wasmSummary = JSON.parse(run(wasmArtifact, ["--source", source, "--typed-ir", typedIrPath]));
  const [bytes, manifest] = await Promise.all([
    readFile(wasmSummary.artifact_path),
    readFile(wasmSummary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes, manifest });
  const wasmPackets = JSON.parse(runtime.readBinding("$ui$compiled$packets"));
  assert.deepEqual(wasmPackets, nativePackets);

  const geom = nativePackets[2].payload.display.geom.world_0_view_0;
  assert.deepEqual(geom.materials, {
    "7": {
      base_color: [0.8, 0.7, 0.6, 1],
      alpha: 1,
      transparent: false,
      depth_write: true,
      light_model: "blinn_phong",
    },
  });
  assert.deepEqual(geom.meshes, [{
    type: "field_mesh",
    id: "world_0_layer_0",
    topology: "triangle-list",
    mode3d: true,
    vertices: [
      0, 0, 0, 0, 0, 1, 0.8, 0.7, 0.6, 1,
      1, 0, 0, 0, 0, 1, 0.8, 0.7, 0.6, 1,
      0, 1, 0, 0, 0, 1, 0.8, 0.7, 0.6, 1,
    ],
    indices: [0, 1, 2],
    material_id: "7",
    depth_write: true,
    no_lighting: false,
    pickable: true,
    layer_id: 0,
  }]);
});

test("malformed World mesh topology rejects atomically on native and WASM", async () => {
  assert.ok(nativeSceneStager, "VKF_NATIVE_SCENE_STAGER must name the focused stager");
  assert.ok(wasmArtifact, "VKF_WASM_ARTIFACT must name the focused WASM emitter");
  const root = path.join(workRoot, "invalid");
  const overlayWeb = path.join(root, "vf-ui");
  const { source, typedIrPath } = await writeOracle(root, meshWorldTypedIr({ topology: [0, 1, 3] }));
  for (const [command, args] of [[nativeSceneStager, [
    "--source", source,
    "--overlay-web", overlayWeb,
    "--typed-ir", typedIrPath,
  ]], [wasmArtifact, ["--source", source, "--typed-ir", typedIrPath]]]) {
    assert.match(runFailure(command, args), /topology indices must reference positions/u);
  }
  assert.equal(existsSync(path.join(root, ".vkfbuild")), false);
  assert.equal(existsSync(path.join(overlayWeb, "sessions")), false);
});
