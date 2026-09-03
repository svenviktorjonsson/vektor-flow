import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compilerBin = process.env.VKF_RELEASE_COMPILER_BIN;
const uiBin = process.env.VKF_RELEASE_UI_BIN;
const workRoot = path.join(repositoryRoot, ".work", `u${process.pid}`);

test.after(async () => {
  await rm(workRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test("the Windows release contains one public vkf and its private UI runtime", {
  skip: process.platform !== "win32",
  timeout: 300_000,
}, async () => {
  assert.ok(compilerBin, "VKF_RELEASE_COMPILER_BIN must name the release compiler directory");
  assert.ok(uiBin, "VKF_RELEASE_UI_BIN must name the private UI runtime directory");
  const relativeCompilerBin = path.relative(repositoryRoot, compilerBin);
  const relativeUiBin = path.relative(repositoryRoot, uiBin);
  const relativeOutput = path.relative(repositoryRoot, path.join(workRoot, "o"));
  for (const relative of [relativeCompilerBin, relativeUiBin, relativeOutput]) {
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false, "release test inputs must stay inside the repository");
  }

  const result = spawnSync("pwsh.exe", [
    "-NoProfile",
    "-File", path.join(repositoryRoot, "scripts", "package-native-release.ps1"),
    "-Version", "0.4.0-test",
    "-BinaryDirectory", relativeCompilerBin,
    "-UiBinaryDirectory", relativeUiBin,
    "-OutputDirectory", relativeOutput,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 280_000,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const stageRoot = path.join(workRoot, "o", "vektor-flow-windows-x64");
  const binFiles = (await readdir(path.join(stageRoot, "bin"))).sort();
  assert.deepEqual(binFiles, [
    "vkf-native-scene-artifact-stager.exe",
    "vkf-runner.exe",
    "vkf-ui-package.exe",
    "vkf_wasm_artifact_smoke.exe",
    "vkf_webgpu_artifact_smoke.exe",
    "vkf.exe",
  ].sort());
  const manifest = JSON.parse(await readFile(path.join(stageRoot, "vektorflow-release.json"), "utf8"));
  assert.equal(manifest.entrypoint, "bin/vkf.exe");
  assert.deepEqual(manifest.not_included_partial_modules, []);
  assert.deepEqual(manifest.stdlib_modules, [
    "math", "stat", "random", "time", "io", "collections", "errors", "system",
    "process", "regex", "linalg", "physics", "physics.units", "physics.units.si",
    "symbolic",
  ]);
  assert.equal(manifest.runtime_contract.python_required, false);
  assert.equal(manifest.runtime_contract.cpp_compiler_required, false);
  const installer = await readFile(path.join(repositoryRoot, "packaging", "windows", "vektor-flow.nsi"), "utf8");
  for (const helper of binFiles.filter((name) => name !== "vkf.exe")) {
    assert.match(installer, new RegExp(`Delete "\\$INSTDIR\\\\bin\\\\${helper.replaceAll(".", "\\.")}"`, "u"));
  }
});
