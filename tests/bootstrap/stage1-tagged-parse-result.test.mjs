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

test("tagged binary expression becomes a one-statement parse result", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i112-tagged-parse-result-"));
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "lexer.vkf"), join(work, "lexer.vkf"));
    copyFileSync(join(root, "compiler", "self_hosted", "parser.vkf"), join(work, "parser.vkf"));
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      "parser: .parser",
      "envelope: lexer.bounded_parser_expression_stream(\"alpha+42\")",
      "left: parser.tagged_cursor(envelope.tokens.(0))",
      "operator: parser.tagged_advance(left, envelope.tokens.(1))",
      "right: parser.tagged_advance(operator, envelope.tokens.(2))",
      "newline: parser.tagged_advance(right, envelope.tokens.(3))",
      "eof: parser.tagged_advance(newline, envelope.tokens.(4))",
      "result: parser.parse_tagged_binary_result(left, operator, right)",
      "statement: result.module.body.(0)",
      ":: result.module.kind",
      ":: result.module.body.length()",
      ":: statement.kind",
      ":: statement.op",
      ":: statement.left.name",
      ":: statement.right.value",
      ":: result.diagnostics.length()",
      ":: eof.index",
      ":: parser.tagged_at_end(eof)",
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
      "module", "1", "binary_op", "+", "alpha", "42", "0", "4", "true",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
