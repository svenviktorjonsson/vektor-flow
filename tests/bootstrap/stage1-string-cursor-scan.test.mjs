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
    writeFileSync(source, " alpha ", "utf8");
    const canonical = spawnSync(lexer, ["--file", source, "<i99>"], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(canonical.status, 0, canonical.stderr);
    const expected = JSON.parse(canonical.stdout).tokens.find(
      (token) => token.kind === "IDENT",
    );
    assert.notEqual(expected, undefined);

    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), [
      expected.kind,
      expected.value,
      String(expected.location.line),
      String(expected.location.column),
      "2",
      "6",
      "true",
      "🙂",
      "2",
      "1",
      "true",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("compiled StringCursor slice rejects a boundary inside a scalar", () => {
  const workRoot = join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i100-cursor-boundary-"));
  try {
    const source = join(work, "mid-scalar.vkf");
    const artifact = join(work, `mid-scalar${executableSuffix}`);
    writeFileSync(source, [
      "StringCursor(source:str):",
      "    bit at_eof: vkf_string_eof(source, 0)",
      "    (source:source, position:0, line:1, column:1, eof:at_eof)",
      "",
      "_string_cursor_slice(cursor:StringCursor, start:int, stop:int) -> str:",
      "    vkf_utf8_slice(cursor.source, start, stop)",
      "",
      "cursor: StringCursor(\"é\")",
      ":: cursor.slice(1, 2)",
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);

    const executed = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.notEqual(executed.status, 0, "mid-scalar slice unexpectedly executed");
    assert.equal(executed.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
