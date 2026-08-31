import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const universalVkf = process.env.VKF_UNIVERSAL_BIN;
const chessRoot = path.join(repositoryRoot, "examples", "programs", "vkf_chess_3d");
const chessSource = path.join(chessRoot, "main.vkf");
const workRoot = path.join(repositoryRoot, ".work", `g03-chess-native-${process.pid}`);
const output = path.join(workRoot, "vkf-chess-3d.exe");

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
  assert.ok(universalVkf, "VKF_UNIVERSAL_BIN must name the packaged vkf executable");
  const source = await readFile(chessSource, "utf8");
  assert.doesNotMatch(source, /native_scene_config_path|native_scene_runtime_packets_path/u);
  assert.doesNotMatch(source, /\.lib\.native_scene|native\.overlay_scene/u);

  await mkdir(workRoot, { recursive: true });
  const stdout = execFileSync(universalVkf, ["-b", chessSource, "-o", output], {
    cwd: chessRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(stdout, /^Built /mu);

  const entries = sceneBundleEntries(await readFile(output));
  for (const runtimeAsset of [
    "vf-chess.css",
    "vf-widgets.js",
    "vf-shared-runtime.js",
    "vf-gpu-runtime.js",
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
  assert.equal(geom.meshes.length, 33, "board plus all 32 pieces must reach the renderer");

  const overlayRoot = path.join(workRoot, "hidden-overlay");
  for (const [relativePath, bytes] of entries) {
    const destination = path.join(overlayRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const hiddenEvidence = JSON.parse(execFileSync(process.execPath, [
    path.join(repositoryRoot, "tests", "helpers", "run_staged_ui_example.js"),
    path.join(overlayRoot, "sessions", "main", "vkf-scene.html"),
    "frame_0",
    "renderer",
    String(9900 + (process.pid % 300)),
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 90_000,
    windowsHide: true,
  }));
  assert.equal(hiddenEvidence.hidden, true);
  assert.equal(hiddenEvidence.frameChrome, true);
  assert.ok(hiddenEvidence.status.runningRenderers > 0);
  assert.match(hiddenEvidence.composite_sha256, /^[0-9a-f]{64}$/u);
});
