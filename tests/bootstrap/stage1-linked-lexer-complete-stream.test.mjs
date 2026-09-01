import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const oracle = join(nativeBin, `vkf_lexer_cursor_smoke${suffix}`);

test("linked self-hosted lexer completes a bounded token stream", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i105-linked-complete-stream-"));
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "lexer.vkf"), join(work, "lexer.vkf"));
    const fixture = "alpha+beta";
    const harness = join(work, "producer.vkf");
    const artifact = join(work, `producer${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      `observed: lexer.identifier_plus_stream(\"${fixture}\")`,
      ...["first", "operator", "third", "newline", "eof"].flatMap((name) => [
        `:: observed.${name}.kind`,
        `:: observed.${name}.value`,
        `:: observed.${name}.line`,
        `:: observed.${name}.column`,
      ]),
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler, ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);

    const source = join(work, "source.vkf");
    writeFileSync(source, fixture, "utf8");
    const canonical = spawnSync(oracle, ["--file", source, "<i105>"], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(canonical.status, 0, canonical.stderr);
    const expected = JSON.parse(canonical.stdout).tokens;
    assert.equal(expected.length, 5);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), expected.flatMap(
      (token) => [
        token.kind,
        String(token.value),
        String(token.location.line),
        String(token.location.column),
      ],
    ));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
