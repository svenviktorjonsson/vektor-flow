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

test("unbounded typed module demand-lowers statements to Machine IR", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i120-typed-machine-ir-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir", "machine_ir"]) {
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
      "mir: .machine_ir",
      `tokens: lexer.tagged_statement_token_tape(${JSON.stringify(source)})`,
      "parsed: parser.parse_tagged_token_tape(tokens.source, tokens.rows, tokens.count)",
      "typed_module: typed.typed_tagged_module(",
      "    parsed.module.body.source, parsed.module.body.rows, parsed.module.body.count",
      ")",
      "machine_module: mir.mir_tagged_module(",
      "    typed_module.source, typed_module.statements, typed_module.count",
      ")",
      "first: mir.mir_tagged_module_statement(machine_module, 0)",
      "last: mir.mir_tagged_module_statement(machine_module, 31)",
      ":: machine_module.count",
      ":: first.name",
      ":: first.instructions.(0).kind",
      ":: first.instructions.(0).index",
      ":: first.instructions.(1).kind",
      ":: first.instructions.(1).value",
      ":: first.instructions.(2).kind",
      ":: first.instructions.(3).kind",
      ":: first.max_stack",
      ":: last.name",
      ":: last.instructions.(1).value",
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
      "32", "value0", "load_local", "0", "push_f64", "1", "add_f64",
      "return_f64", "2", "value31", "32",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
