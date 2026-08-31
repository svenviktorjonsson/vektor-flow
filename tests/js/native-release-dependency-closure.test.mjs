import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repositoryRoot = process.cwd();
const verifier = path.join(repositoryRoot, "tools", "verify-windows-release-closure.mjs");
const moduleTracer = path.join(repositoryRoot, "scripts", "trace-native-release-modules.ps1");
const testWorkRoot = path.join(repositoryRoot, "build", "native-release-closure-tests");
mkdirSync(testWorkRoot, { recursive: true });

function makeWork(prefix) {
  return mkdtempSync(path.join(testWorkRoot, prefix));
}

function runVerifier(binary) {
  return spawnSync(process.execPath, [verifier, `--binary=${binary}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
}

test(
  "Windows release PE gate rejects a non-system runtime import",
  { skip: process.platform !== "win32" },
  () => {
    const work = makeWork("import-");
    try {
      const systemBinary = path.join(process.env.SystemRoot, "System32", "where.exe");
      const allowed = runVerifier(systemBinary);
      assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

      const mutated = path.join(work, "forbidden-runtime.exe");
      copyFileSync(systemBinary, mutated);
      const bytes = readFileSync(mutated);
      const original = Buffer.from("KERNEL32.dll\0", "ascii");
      const replacement = Buffer.from("MSVCP140.dll\0", "ascii");
      assert.equal(original.length, replacement.length);
      const importOffset = bytes.indexOf(original);
      assert.notEqual(importOffset, -1, "fixture omitted its KERNEL32 import name");
      replacement.copy(bytes, importOffset);
      writeFileSync(mutated, bytes);

      const rejected = runVerifier(mutated);
      assert.notEqual(rejected.status, 0, "forbidden runtime import passed the release gate");
      assert.match(rejected.stderr, /forbidden PE import MSVCP140\.dll/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
);

test(
  "Windows release closure rejects bundled native libraries",
  { skip: process.platform !== "win32" },
  () => {
    const work = makeWork("files-");
    try {
      const bin = path.join(work, "bin");
      mkdirSync(bin);
      for (const name of [
        "vkf.exe",
        "vkf-ui-package.exe",
        "vkf-runner.exe",
        "vkf-native-scene-artifact-stager.exe",
      ]) {
        copyFileSync(path.join(process.env.SystemRoot, "System32", "where.exe"), path.join(bin, name));
      }
      writeFileSync(path.join(bin, "third-party.dll"), "not allowed");

      const result = spawnSync(process.execPath, [verifier, `--release-root=${work}`], {
        cwd: repositoryRoot,
        encoding: "utf8",
        windowsHide: true,
      });
      assert.notEqual(result.status, 0, "bundled native library passed the release gate");
      assert.match(result.stderr, /bundled native library.*third-party\.dll/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
);

test("Windows release link-map gate rejects native UI semantics", () => {
  const work = makeWork("map-");
  try {
    const allowedMap = path.join(work, "allowed.map");
    writeFileSync(allowedMap, "0001:00000000 main.cpp.obj\n0001:00000020 ui_runtime_contract.cpp.obj\n");
    const allowed = spawnSync(process.execPath, [verifier, `--link-map=${allowedMap}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

    const forbiddenMap = path.join(work, "forbidden.map");
    writeFileSync(
      forbiddenMap,
      "0001:00000000 main.cpp.obj\n0001:00000020 compiled_ui_bootstrap_runtime.cpp.obj\n",
    );
    const rejected = spawnSync(process.execPath, [verifier, `--link-map=${forbiddenMap}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.notEqual(rejected.status, 0, "native UI semantics passed the link-map gate");
    assert.match(rejected.stderr, /forbidden native UI semantics.*compiled_ui_bootstrap_runtime/i);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test(
  "Windows release closure exercises toolchain-free compilation",
  { skip: process.platform !== "win32" },
  () => {
    const work = makeWork("compile-");
    try {
      const release = path.join(work, "release");
      const bin = path.join(release, "bin");
      mkdirSync(bin, { recursive: true });
      for (const name of [
        "vkf.exe",
        "vkf-ui-package.exe",
        "vkf-runner.exe",
        "vkf-native-scene-artifact-stager.exe",
      ]) {
        copyFileSync(path.join(process.env.SystemRoot, "System32", "where.exe"), path.join(bin, name));
      }

      const result = spawnSync(process.execPath, [
        verifier,
        `--release-root=${release}`,
        "--probe-toolchain-free",
        `--probe-root=${path.join(work, "probe")}`,
      ], {
        cwd: repositoryRoot,
        encoding: "utf8",
        windowsHide: true,
      });
      assert.notEqual(result.status, 0, "release gate ignored its compile probe");
      assert.match(result.stderr, /toolchain-free console compile probe failed/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  },
);

test("Windows release module trace uses valid helper execution paths", () => {
  const source = readFileSync(moduleTracer, "utf8");
  assert.match(source, /Trace-HiddenProcess\s+"toolchain-free-ui-compile"/);
  assert.match(source, /Trace-HiddenProcess\s+"native-scene-artifact-stage"/);
  assert.doesNotMatch(source, /Trace-HiddenProcess\s+"vkf-(?:runner|ui-package|native-scene-artifact-stager)"/);
  assert.match(source, /VektorFlowModuleTrace-/);
  assert.match(source, /windows-network-provider-extension/);
  assert.match(source, /NameSpace_Catalog5/);
});
