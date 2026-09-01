import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);
const lexer = join(nativeBin, `vkf_lexer_cursor_smoke${executableSuffix}`);
const fixture = join(
  root,
  "tests",
  "bootstrap",
  "fixtures",
  "string-cursor-identifier-scan.vkf",
);

test("compiled StringCursor identifier scan matches the canonical lexer", () => {
  const workRoot = join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i99-cursor-scan-"));
  try {
    const artifact = join(work, `cursor-scan${executableSuffix}`);
    const compiled = spawnSync(
      compiler,
      ["-b", fixture, "-o", artifact, "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);

    const executed = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);

    const source = join(work, "source.vkf");
    writeFileSync(source, "alpha ", "utf8");
    const canonical = spawnSync(lexer, ["--file", source, "<i99>"], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(canonical.status, 0, canonical.stderr);
    const expected = JSON.parse(canonical.stdout).tokens[0];

    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), [
      expected.kind,
      expected.value,
      String(expected.line),
      String(expected.column),
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
