import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const stager = process.env.VKF_NATIVE_SCENE_STAGER;
const work = path.join(
  repositoryRoot,
  ".w",
  `native-scene-compiled-arena-bootstrap-${process.pid}`,
);

after(() => rm(work, { recursive: true, force: true }));

test("compiled scene bootstrap binds the WASM arena without fetching a legacy arena", {
  skip: !stager,
}, async () => {
  const source = path.join(work, "app.vkf");
  const overlay = path.join(work, "web");
  const wasm = path.join(work, "app.wasm");
  const wasmManifest = path.join(work, "app.wasm-manifest.json");
  const wgsl = path.join(work, "app.wgsl");
  const webGpuManifest = path.join(work, "app.webgpu-manifest.json");
  await mkdir(overlay, { recursive: true });
  await cp(path.join(repositoryRoot, "web", "vf-ui"), overlay, {
    recursive: true,
  });
  await Promise.all([
    writeFile(source, "value: 1\n", "utf8"),
    writeFile(wasm, Buffer.from([0x00, 0x61, 0x73, 0x6d])),
    writeFile(wgsl, "@compute @workgroup_size(1) fn main() {}\n", "utf8"),
    writeFile(wasmManifest, JSON.stringify({
      artifact_kind: "wasm",
      artifact_path: wasm,
      runtime_surface: {
        retained_scene_arena: {
          schema: "vektor-flow/retained-scene-arena",
          version: 1,
        },
      },
      status: "current",
    }), "utf8"),
    writeFile(webGpuManifest, JSON.stringify({
      artifact_kind: "webgpu-wgsl",
      artifact_path: wgsl,
      runtime_surface: { update_mode: "retained_scene_render" },
      status: "current",
    }), "utf8"),
  ]);
  const runtimePackets = JSON.stringify([{
    seq: 1,
    kind: "scene.replace",
    payload: {
      commands: [{
        kind: "frame_upsert",
        payload: {
          spec: {
            id: "compiled_arena",
            title: "",
            rect: { x: 0.04, y: 0.06, w: 0.72, h: 0.84 },
            aspect: null,
          },
        },
      }],
    },
  }]);
  const result = spawnSync(stager, [
    "--source", source,
    "--overlay-web", overlay,
    "--scene-config", "[]",
    "--runtime-packets", runtimePackets,
    "--wasm-artifact", wasm,
    "--wasm-manifest", wasmManifest,
    "--webgpu-artifact", wgsl,
    "--webgpu-manifest", webGpuManifest,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);

  const session = path.join(overlay, "sessions", "app");
  const page = await readFile(path.join(session, "vkf-scene.html"), "utf8");
  assert.match(
    page,
    /loadCompiledArtifacts\(\).*bindCompiledScene/u,
    "scene config must bind only after compiled artifacts are ready",
  );
  assert.match(page, /__vfNativeSceneArenaUrl=""/u);
  assert.doesNotMatch(page, /fetch\(arenaUrl/u);
  assert.doesNotMatch(
    page,
    /vf-native-scene\.js|vf-native-scene-adapters\.js|geom\/vf-geom-|vf-axis3d-|vf-gpu-runtime\.js/u,
    "compiled retained scenes must not load the JavaScript compute renderer",
  );
  assert.match(page, /ensureCompiledDependencies\(\)/u);
  assert.match(page, /vf-runtime-packet-contract\.js/u);
  assert.match(page, /vf-retained-event-adapter\.js/u);
  assert.match(page, /vf-html-components\.js/u);
  assert.match(page, /vf-static-html-loader\.js/u);
  assert.match(
    page,
    /mountLaunchFramesFromUrl\(.*launchManifestUrl/u,
    "compiled retained scenes must mount the declared frame before the canvas",
  );
  assert.match(
    page,
    /expectFrames\(/u,
    "compiled retained scenes must arm atomic startup before presentation",
  );
  assert.match(
    page,
    /loadCompiledArtifacts\(\).*bindCompiledScene\(.*bootCompiledScene\(/u,
    "compiled retained scenes must enter the WASM/WGSL runtime directly",
  );
  assert.deepEqual(
    (await readdir(session)).filter((name) =>
      name.startsWith("vf-native-scene-arena-") && name.endsWith(".bin")
    ),
    [],
  );
});
