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

test("numeric binding closes a later dynamic expression in typed IR", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i123-dynamic-binding-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) {
      copyFileSync(
        join(root, "compiler", "self_hosted", `${name}.vkf`),
        join(work, `${name}.vkf`),
      );
    }
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      "tokens: lexer.tagged_statement_token_tape(\"value: 31\\nvalue + 1\")",
      "parsed: parser.parse_tagged_token_tape(tokens.source, tokens.rows, tokens.count)",
      "module: typed.typed_tagged_module(",
      "    parsed.module.body.source, parsed.module.body.rows, parsed.module.body.count",
      ")",
      "binding: typed.typed_tagged_binding(module, 0)",
      "expression: typed.typed_tagged_bound_statement(module, 1, binding)",
      ":: tokens.count",
      ":: parsed.module.body.count",
      ":: parsed.module.body.rows.(2)",
      ":: parsed.module.body.rows.(10)",
      ":: binding.kind",
      ":: binding.name",
      ":: binding.value.kind",
      ":: binding.value.value",
      ":: binding.type",
      ":: expression.left.name",
      ":: expression.left.type",
      ":: expression.right.value",
      ":: expression.right.type",
      ":: expression.type",
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
      "9", "2", "2", "1", "store_binding", "value", "const", "31", "int",
      "value", "int", "1", "int", "int",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
