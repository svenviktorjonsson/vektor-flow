import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeDriver = process.env.VKF_NATIVE_DRIVER;
const nativeCompilerBin = process.env.VKF_NATIVE_COMPILER_BIN;
const chessRoot = path.join(repositoryRoot, "examples", "programs", "vkf_chess_3d");
const chessSource = path.join(chessRoot, "main.vkf");
const workRoot = path.join(repositoryRoot, ".work", `g03-chess-native-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function sceneBundleEntries(application) {
  const footer = Buffer.from("VKF_SCENE_BUNDLE_END_V1");
  assert.deepEqual(application.subarray(application.length - footer.length), footer);
  const sizeOffset = application.length - footer.length - 8;
  const payloadSize = Number(application.readBigUInt64LE(sizeOffset));
  const payload = application.subarray(sizeOffset - payloadSize, sizeOffset);
  const header = Buffer.from("VKF_SCENE_BUNDLE_V1\n");
  assert.deepEqual(payload.subarray(0, header.length), header);
  let offset = header.length;
  const count = payload.readUInt32LE(offset);
  offset += 4;
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const pathLength = payload.readUInt32LE(offset);
    offset += 4;
    const dataLength = Number(payload.readBigUInt64LE(offset));
    offset += 8;
    const relativePath = payload.subarray(offset, offset + pathLength).toString("utf8");
    offset += pathLength;
    entries.set(relativePath, payload.subarray(offset, offset + dataLength));
    offset += dataLength;
  }
  assert.equal(offset, payload.length);
  return entries;
}

test("the shipped chess application uses compiler-owned retained-scene staging", {
  skip: process.platform !== "win32",
  timeout: 180_000,
}, async () => {
  assert.ok(nativeDriver, "VKF_NATIVE_DRIVER must name the focused native compiler driver");
  assert.ok(
    nativeCompilerBin,
    "VKF_NATIVE_COMPILER_BIN must name the focused native artifact build directory",
  );
  const source = await readFile(chessSource, "utf8");
  assert.doesNotMatch(source, /native_scene_config_path|native_scene_runtime_packets_path/u);
  assert.doesNotMatch(source, /\.lib\.native_scene|native\.overlay_scene/u);
  assert.doesNotMatch(source, /native_scene|add_light/u);
  await assert.rejects(
    access(path.join(chessRoot, "lib", "native_scene.vkf")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(path.join(chessRoot, "runtime-packets", "main.vf-runtime-packets.json")),
    { code: "ENOENT" },
  );

  const stagedSourceRoot = path.join(workRoot, "vkf_chess_3d");
  const stagedSource = path.join(stagedSourceRoot, "main.vkf");
  const output = path.join(stagedSourceRoot, "main.exe");
  const capturePath = path.join(workRoot, "native-frame-capture.json");
  await mkdir(workRoot, { recursive: true });
  await cp(chessRoot, stagedSourceRoot, { recursive: true });
  const executable = (name) => path.join(
    nativeCompilerBin,
    process.platform === "win32" ? `${name}.exe` : name,
  );
  const stdout = execFileSync(nativeDriver, [
    "--source",
    stagedSource,
    "--wasm-artifact",
    executable("vkf_wasm_artifact_smoke"),
    "--webgpu-artifact",
    executable("vkf_webgpu_artifact_smoke"),
  ], {
    cwd: stagedSourceRoot,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      VKF_NATIVE_FRAME_CAPTURE_PATH: capturePath,
    },
  });
  assert.equal(JSON.parse(stdout).status, "compiled");

  const entries = sceneBundleEntries(await readFile(output));
  for (const runtimeAsset of [
    "vf-chess.css",
    "vf-widgets.js",
    "vf-shared-runtime.js",
    "vf-gpu-runtime.js",
    "geom/vf-clustered-light-plan.mjs",
    "geom/vf-light-view-bounds.mjs",
    "assets/fonts/NotoSans-Regular-chess-sdf.png",
  ]) {
    assert.ok(entries.has(runtimeAsset), `packaged chess runtime omitted ${runtimeAsset}`);
  }
  const packets = JSON.parse(entries.get("sessions/main/vf-runtime-packets.json"));
  const frameCommands = packets
    .filter(({ kind }) => kind === "scene.replace")
    .flatMap(({ payload }) => payload.commands);
  assert.ok(
    frameCommands.some(({ kind, id }) => kind === "frame_upsert" && id === "frame_0"),
    "compiler-produced chess scene must retain its board frame",
  );
  const geom = packets.find(({ kind }) => kind === "display.replace").payload.display.geom.frame_0;
  assert.equal(
    geom.meshes.length,
    35,
    "board, all 32 pieces, and both emissive geometries must reach the renderer",
  );
  assert.ok(geom.meshes.some(({ id }) => id === "key"));
  assert.ok(geom.meshes.some(({ id }) => id === "fill"));

  const capture = JSON.parse(execFileSync(process.execPath, [
    path.join(
      repositoryRoot,
      "tests",
      "helpers",
      "capture_native_frame.js",
    ),
    capturePath,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  }));
  assert.equal(capture.capture_api, "Frame.capture");
  assert.equal(capture.boundary, "frame-internal");
  assert.equal(capture.states.length, 2);
  assert.ok(capture.states.every(({ width, height }) => width > 0 && height > 0));
});
