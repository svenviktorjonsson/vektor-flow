import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const archivePath = process.env.VKF_WINDOWS_RELEASE_ARCHIVE;

test(
  "the Windows portable archive runs from a fresh isolated extraction",
  {
    skip: process.platform !== "win32" || !archivePath,
    timeout: 120_000,
  },
  () => {
    const result = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        path.join(repositoryRoot, "scripts/test-windows-portable-archive.ps1"),
        "-ArchivePath",
        archivePath,
        "-Json",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.archiveHashVerified, true);
    assert.equal(summary.extractionOutsideRepository, true);
    assert.equal(summary.developerPathRemoved, true);
    assert.equal(summary.extractedStdlibSentinel, 43117);
    assert.equal(summary.inlineOutput, "archive ready");
    assert.equal(summary.sampleOutput, "hello, world");
    assert.equal(summary.runtimeContract.python_required, false);
    assert.equal(summary.runtimeContract.cpp_compiler_required, false);
  },
);

test("Windows packaging verifies the completed archive", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "scripts/package-native-release.ps1"),
    "utf8",
  );
  const archiveIndex = source.indexOf("Compress-Archive");
  const verificationIndex = source.lastIndexOf(
    "test-windows-portable-archive.ps1",
  );
  assert.ok(archiveIndex >= 0);
  assert.ok(verificationIndex > archiveIndex);
  assert.match(source, /test-windows-portable-archive\.ps1/u);
});
