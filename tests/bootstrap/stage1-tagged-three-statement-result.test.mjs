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

test("general module append reaches three bounded statements", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i116-tagged-three-statement-"));
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "lexer.vkf"), join(work, "lexer.vkf"));
    copyFileSync(join(root, "compiler", "self_hosted", "parser.vkf"), join(work, "parser.vkf"));
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      "parser: .parser",
      "first_envelope: lexer.bounded_two_expression_stream(\"alpha+42\\nbeta+7\")",
      "first_left: parser.tagged_cursor(first_envelope.tokens.(0))",
      "first_operator: parser.tagged_advance(first_left, first_envelope.tokens.(1))",
      "first_right: parser.tagged_advance(first_operator, first_envelope.tokens.(2))",
      "separator: parser.tagged_advance(first_right, first_envelope.tokens.(3))",
      "second_left: parser.tagged_advance(separator, first_envelope.tokens.(4))",
      "second_operator: parser.tagged_advance(second_left, first_envelope.tokens.(5))",
      "second_right: parser.tagged_advance(second_operator, first_envelope.tokens.(6))",
      "first_result: parser.parse_tagged_two_statement_result(",
      "    first_left, first_operator, first_right,",
      "    second_left, second_operator, second_right",
      ")",
      "third_envelope: lexer.bounded_parser_expression_stream(\"\\n\\ngamma+9\")",
      "third_left: parser.tagged_cursor(third_envelope.tokens.(0))",
      "third_operator: parser.tagged_advance(third_left, third_envelope.tokens.(1))",
      "third_right: parser.tagged_advance(third_operator, third_envelope.tokens.(2))",
      "third_newline: parser.tagged_advance(third_right, third_envelope.tokens.(3))",
      "third_eof: parser.tagged_advance(third_newline, third_envelope.tokens.(4))",
      "result: parser.append_tagged_third_statement(",
      "    first_result, third_left, third_operator, third_right",
      ")",
      ":: result.module.body.length()",
      ":: result.module.body.(0).left.name",
      ":: result.module.body.(1).left.name",
      ":: result.module.body.(2).left.name",
      ":: result.module.span.stop.line",
      ":: result.module.span.stop.column",
      ":: result.diagnostics.length()",
      ":: third_eof.index",
      ":: parser.tagged_at_end(third_eof)",
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
      "3", "alpha", "beta", "gamma", "3", "7", "0", "4", "true",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
