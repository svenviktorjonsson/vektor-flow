import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compilerBin = process.env.VKF_UI_ARTIFACT_COMPILER_BIN;
const uiBin = process.env.VKF_UI_ARTIFACT_PACKAGE_BIN;
const work = path.join(root, ".w", `ui-artifact-package-${process.pid}`);
const fixture = path.join(root, "tests", "fixtures", "ui-wasm-dom-only");

function bundledFiles(application) {
  const footer = Buffer.from("VKF_SCENE_BUNDLE_END_V1");
  assert.deepEqual(application.subarray(-footer.length), footer);
  const sizeOffset = application.length - footer.length - 8;
  const payloadSize = Number(application.readBigUInt64LE(sizeOffset));
  const payload = application.subarray(sizeOffset - payloadSize, sizeOffset);
  const header = Buffer.from("VKF_SCENE_BUNDLE_V1\n");
  assert.deepEqual(payload.subarray(0, header.length), header);
  let offset = header.length;
  const count = payload.readUInt32LE(offset);
  offset += 4;
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    const pathLength = payload.readUInt32LE(offset);
    offset += 4;
    const dataLength = Number(payload.readBigUInt64LE(offset));
    offset += 8;
    const relative = payload.subarray(offset, offset + pathLength).toString("utf8");
    offset += pathLength;
    files.set(relative, payload.subarray(offset, offset + dataLength));
    offset += dataLength;
  }
  assert.equal(offset, payload.length);
  return files;
}

test.after(async () => {
  await rm(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});

test("vkf -b packages compiler WASM and WGSL for a UI application", {
  skip: process.platform !== "win32" || !compilerBin || !uiBin,
  timeout: 120_000,
}, async () => {
  const bin = path.join(work, "bin");
  const sourceRoot = path.join(work, "source");
  const source = path.join(sourceRoot, "app.vkf");
  const output = path.join(sourceRoot, "app.exe");
  await Promise.all([
    mkdir(bin, { recursive: true }),
    cp(fixture, sourceRoot, { recursive: true }),
  ]);
  await copyFile(path.join(compilerBin, "vkf-strict.exe"), path.join(bin, "vkf.exe"));
  for (const executable of [
    "vkf_wasm_artifact_smoke.exe",
    "vkf_webgpu_artifact_smoke.exe",
  ]) {
    await copyFile(path.join(compilerBin, executable), path.join(bin, executable));
  }
  for (const executable of [
    "vkf-ui-package.exe",
    "vkf-runner.exe",
    "vkf-native-scene-artifact-stager.exe",
  ]) {
    await copyFile(path.join(uiBin, executable), path.join(bin, executable));
  }
  execFileSync(path.join(bin, "vkf.exe"), ["-b", source, "-o", output], {
    cwd: sourceRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const files = bundledFiles(await readFile(output));
  const expected = [
    "sessions/app/vkf-program.wasm",
    "sessions/app/vkf-program.wasm-manifest.json",
    "sessions/app/vkf-render.wgsl",
    "sessions/app/vkf-render.webgpu-manifest.json",
  ];
  for (const relative of expected) {
    assert.ok(files.has(relative), `missing compiled UI artifact ${relative}`);
    assert.ok(files.get(relative).length > 0, `empty compiled UI artifact ${relative}`);
  }
  const wasm = files.get(expected[0]);
  assert.deepEqual([...wasm.subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
  assert.match(files.get(expected[2]).toString("utf8"), /@(?:vertex|compute|fragment)\b/u);
  const wasmManifest = JSON.parse(files.get(expected[1]));
  assert.equal(wasmManifest.artifact_kind, "wasm");
  assert.equal(wasmManifest.artifact_path, "vkf-program.wasm");
  assert.equal(wasmManifest.status, "compiled");
  const webgpuManifest = JSON.parse(files.get(expected[3]));
  assert.equal(webgpuManifest.artifact_kind, "webgpu-wgsl");
  assert.equal(webgpuManifest.artifact_path, "vkf-render.wgsl");
  assert.equal(webgpuManifest.status, "compiled");
  assert.equal(webgpuManifest.runtime_surface.update_mode, "dom_only");
  const page = files.get("sessions/app/vkf-scene.html").toString("utf8");
  assert.match(page, /compiledWasmUrl:"vkf-program\.wasm"/u);
  assert.match(page, /compiledWasmManifestUrl:"vkf-program\.wasm-manifest\.json"/u);
  assert.match(page, /compiledWgslUrl:"vkf-render\.wgsl"/u);
  assert.match(page, /compiledWebGpuManifestUrl:"vkf-render\.webgpu-manifest\.json"/u);
  assert.match(page, /data-vf-runtime-autoboot="false"/u);
  assert.match(page, /ensureSceneDependencies\(\)\.then\(function\(\)\{return shell\.loadCompiledArtifacts\(\);\}\)/u);
  assert.match(page, /Promise\.all\(\[frame,artifacts\]\).*shell\.boot\(options\)/u);
  assert.doesNotMatch(
    page,
    /ensureCompiledDependencies\(\)|bootCompiledScene\(/u,
    "DOM-only packages keep their existing runtime-shell path",
  );
  assert.equal(await readFile(source, "utf8").then(Boolean), true);
});
