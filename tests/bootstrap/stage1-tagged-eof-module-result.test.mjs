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

test("parser consumes token tape through EOF into an unbounded module result", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i118-tagged-eof-module-"));
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "lexer.vkf"), join(work, "lexer.vkf"));
    copyFileSync(join(root, "compiler", "self_hosted", "parser.vkf"), join(work, "parser.vkf"));
    const source = Array.from({ length: 32 }, (_, index) => `value${index}+${index + 1}`).join("\n");
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      "parser: .parser",
      `tokens: lexer.tagged_statement_token_tape(${JSON.stringify(source)})`,
      "result: parser.parse_tagged_token_tape(tokens)",
      "first: parser.tagged_module_statement(result.module, 0)",
      "last: parser.tagged_module_statement(result.module, 31)",
      ":: result.module.kind",
      ":: result.module.body.count",
      ":: result.module.body.rows.length()",
      ":: first.left.name",
      ":: first.right.value",
      ":: last.left.name",
      ":: last.right.value",
      ":: result.module.span.stop.line",
      ":: result.module.span.stop.column",
      ":: result.diagnostics.length()",
      "",
    ].join("\n"), "utf8");

    const compiled = spawnSync(
      compiler, ["-b", harness, "-o", artifact, "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), [
      "module", "32", "256", "value0", "1", "value31", "32", "32", "9", "0",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
