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
const newline = process.platform === "win32" ? "\r\n" : "\n";

test("two derived bindings close a later demanded expression", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i132-derived-chain-"));
  try {
    for (const name of [
      "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation",
    ]) {
      copyFileSync(join(root, "compiler", "self_hosted", `${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "producer.vkf");
    const artifact = join(work, `producer${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      "mir: .machine_ir",
      "validation: .machine_ir_validation",
      'tokens: lexer.tagged_statement_token_tape("base: 30\\nfirst: base + 1\\nsecond: first + 1\\nsecond + 1")',
      "parsed: parser.parse_tagged_two_derived_bindings(tokens.source, tokens.rows, tokens.count)",
      "expression: typed.typed_tagged_two_derived_bindings(parsed.kind, parsed.values)",
      "statement: mir.mir_tagged_dynamic_two_derived_bindings(expression.values)",
      "maximum: validation.machine_ir_numeric_opcode_tape_stack_maximum(statement.opcodes)",
      "module: mir.mir_assemble_closed_dynamic_dependency_module(statement, maximum)",
      ":: module.schema", ":: module.version", ":: module.output_kind",
      ":: module.output_count", ":: module.entry.name", ":: module.entry.max_stack",
      ":: module.entry.instructions.0.kind", ":: module.entry.instructions.0.value",
      ":: module.entry.instructions.1.kind", ":: module.entry.instructions.1.value",
      ":: module.entry.instructions.2.kind",
      ":: module.entry.instructions.3.kind", ":: module.entry.instructions.3.value",
      ":: module.entry.instructions.4.kind",
      ":: module.entry.instructions.5.kind", ":: module.entry.instructions.5.value",
      ":: module.entry.instructions.6.kind", ":: module.entry.instructions.7.kind",
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);

    const expected = [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "2",
      "push_f64", "30", "push_f64", "1", "add_f64",
      "push_f64", "1", "add_f64", "push_f64", "1", "add_f64", "return_f64",
    ].join(newline) + newline;
    const oracle = join(work, "oracle.txt");
    writeFileSync(oracle, expected, "utf8");
    const output = join(work, `chain${suffix}`);
    const provenance = join(work, "provenance.json");
    const dispatched = spawnSync(
      compiler,
      [
        "--vkf-internal-stage-component",
        "machine_ir.closed_dependency_chain.typed_module_pipeline",
        artifact, source, oracle, output, provenance,
      ],
      { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    assert.equal(dispatched.status, 0, dispatched.stderr);
    const executed = spawnSync(output, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, `33${newline}`);
    assert.equal(JSON.parse(readFileSync(provenance, "utf8")).exact_oracle_match, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
