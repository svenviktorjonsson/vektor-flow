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

test("validated dynamic statement assembles into a version-4 MachineModule", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i122-validated-module-"));
  try {
    for (const name of [
      "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation",
    ]) {
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
      "validation: .machine_ir_validation",
      `tokens: lexer.tagged_statement_token_tape(${JSON.stringify(source)})`,
      "parsed: parser.parse_tagged_token_tape(tokens.source, tokens.rows, tokens.count)",
      "typed_module: typed.typed_tagged_module(",
      "    parsed.module.body.source, parsed.module.body.rows, parsed.module.body.count",
      ")",
      "dynamic_module: mir.mir_tagged_module(",
      "    typed_module.source, typed_module.statements, typed_module.count",
      ")",
      "statement: mir.mir_tagged_module_statement(dynamic_module, 31)",
      "maximum: validation.machine_ir_tagged_statement_stack_maximum(",
      "    statement.instructions.0.kind, statement.instructions.1.kind,",
      "    statement.instructions.2.kind, statement.instructions.3.kind",
      ")",
      "module: mir.mir_assemble_tagged_statement_module(dynamic_module, 31, maximum)",
      ":: module.schema",
      ":: module.version",
      ":: module.output_kind",
      ":: module.entry.name",
      ":: module.entry.parameters.length()",
      ":: module.entry.parameters.0",
      ":: module.entry.max_stack",
      ":: module.entry.instructions.0.kind",
      ":: module.entry.instructions.1.value",
      ":: module.entry.instructions.2.kind",
      ":: module.entry.instructions.3.kind",
      ":: module.functions.length()",
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
      "vektorflow.machine_ir", "4", "none", "value31", "1", "num", "2",
      "load_local", "32", "add_f64", "return_f64", "0",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
