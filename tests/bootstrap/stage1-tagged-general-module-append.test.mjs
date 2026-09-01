import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);

test("bounded module append uses owned aggregate concatenation", () => {
  const parserSource = readFileSync(
    join(root, "compiler", "self_hosted", "parser.vkf"), "utf8",
  );
  assert.match(parserSource, /body:result\.module\.body\s*&\s*\[expression\]/u);

  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i116-tagged-general-append-"));
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "lexer.vkf"), join(work, "lexer.vkf"));
    copyFileSync(join(root, "compiler", "self_hosted", "parser.vkf"), join(work, "parser.vkf"));
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      "parser: .parser",
      "envelope: lexer.bounded_two_expression_stream(\"alpha+42\\nbeta+7\")",
      "first_left: parser.tagged_cursor(envelope.tokens.(0))",
      "first_operator: parser.tagged_advance(first_left, envelope.tokens.(1))",
      "first_right: parser.tagged_advance(first_operator, envelope.tokens.(2))",
      "separator: parser.tagged_advance(first_right, envelope.tokens.(3))",
      "second_left: parser.tagged_advance(separator, envelope.tokens.(4))",
      "second_operator: parser.tagged_advance(second_left, envelope.tokens.(5))",
      "second_right: parser.tagged_advance(second_operator, envelope.tokens.(6))",
      "first_result: parser.parse_tagged_binary_result(",
      "    first_left, first_operator, first_right",
      ")",
      "result: parser.append_tagged_binary_statement(",
      "    first_result, second_left, second_operator, second_right",
      ")",
      ":: result.module.body.(0).left.name",
      ":: result.module.body.(1).left.name",
      ":: result.module.body.length()",
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
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), ["alpha", "beta", "2"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
