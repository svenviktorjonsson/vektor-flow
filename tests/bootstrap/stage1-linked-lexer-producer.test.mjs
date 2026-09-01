import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);
const canonicalLexer = join(nativeBin, `vkf_lexer_cursor_smoke${executableSuffix}`);
const lexerSource = join(root, "compiler", "self_hosted", "lexer.vkf");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("linked self-hosted lexer produces the canonical identifier token", () => {
  const workRoot = join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i101-linked-lexer-"));
  try {
    const copiedLexer = join(work, "lexer.vkf");
    copyFileSync(lexerSource, copiedLexer);
    assert.equal(sha256(copiedLexer), sha256(lexerSource));

    const harness = join(work, "producer.vkf");
    const artifact = join(work, `producer${executableSuffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      "observed: lexer.identifier_token(\" alpha \", 1)",
      ":: observed.kind",
      ":: observed.value",
      ":: observed.line",
      ":: observed.column",
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"],
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
    const canonical = spawnSync(canonicalLexer, ["--file", source, "<i101>"], {
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
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
