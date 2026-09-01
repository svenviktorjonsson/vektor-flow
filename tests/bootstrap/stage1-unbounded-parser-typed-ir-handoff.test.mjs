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

test("unbounded parser module hands typed statements to typed IR on demand", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i119-parser-typed-ir-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir"]) {
      copyFileSync(
        join(root, "compiler", "self_hosted", `${name}.vkf`),
        join(work, `${name}.vkf`),
      );
    }
    const source = Array.from({ length: 32 }, (_, index) => `value${index}+${index + 1}`).join("\n");
    const harness = join(work, "probe.vkf");
    const artifact = join(work, `probe${suffix}`);
    writeFileSync(harness, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      `tokens: lexer.tagged_statement_token_tape(${JSON.stringify(source)})`,
      "parsed: parser.parse_tagged_token_tape(tokens.source, tokens.rows, tokens.count)",
      "module: typed.typed_tagged_module(",
      "    parsed.module.body.source,",
      "    parsed.module.body.rows,",
      "    parsed.module.body.count",
      ")",
      "first: typed.typed_tagged_module_statement(module, 0)",
      "last: typed.typed_tagged_module_statement(module, 31)",
      ":: module.kind",
      ":: module.count",
      ":: first.kind",
      ":: first.left.kind",
      ":: first.left.name",
      ":: first.left.type",
      ":: first.op",
      ":: first.right.kind",
      ":: first.right.value",
      ":: first.right.type",
      ":: first.type",
      ":: last.left.name",
      ":: last.right.value",
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
      "typed_module", "32", "binary_op", "load", "value0", "any", "PLUS",
      "const", "1", "int", "any", "value31", "32",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
