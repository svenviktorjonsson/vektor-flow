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

test("linked self-hosted lexer emits the identifier-number parity fixture", () => {
  const workRoot = join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i103-linked-number-stream-"));
  try {
    const copiedLexer = join(work, "lexer.vkf");
    copyFileSync(lexerSource, copiedLexer);
    assert.equal(sha256(copiedLexer), sha256(lexerSource));

    const fixture = "alpha 123 beta45 6.7";
    const harness = join(work, "producer.vkf");
    const artifact = join(work, `producer${executableSuffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      `observed: lexer.identifier_number_tokens(\"${fixture}\")`,
      ...["first", "second", "third", "fourth"].flatMap((name) => [
        `:: observed.${name}.kind`,
        `:: observed.${name}.value`,
        `:: observed.${name}.line`,
        `:: observed.${name}.column`,
      ]),
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
    writeFileSync(source, fixture, "utf8");
    const canonical = spawnSync(canonicalLexer, ["--file", source, "<i103>"], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(canonical.status, 0, canonical.stderr);
    const expected = JSON.parse(canonical.stdout).tokens.filter(
      (token) => token.kind === "IDENT" || token.kind === "NUMBER",
    );
    assert.equal(expected.length, 4);
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
