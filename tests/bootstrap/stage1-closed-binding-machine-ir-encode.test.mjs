import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);
const component = "machine_ir.closed_binding.typed_module_pipeline";
const newline = process.platform === "win32" ? "\r\n" : "\n";

function makeWork() {
  const workRoot = join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i124-closed-binding-"));
  for (const name of [
    "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation",
  ]) {
    copyFileSync(
      join(root, "compiler", "self_hosted", `${name}.vkf`),
      join(work, `${name}.vkf`),
    );
  }
  return work;
}

function compile(source, artifact) {
  const result = spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
  assert.equal(result.status, 0, result.stderr);
}

test("known binding closes, validates, and encodes a zero-parameter v4 module", () => {
  const work = makeWork();
  try {
    const source = join(work, "producer.vkf");
    const artifact = join(work, `producer${suffix}`);
    writeFileSync(source, [
      "lexer: .lexer",
      "parser: .parser",
      "typed: .typed_ir",
      "mir: .machine_ir",
      "validation: .machine_ir_validation",
      'tokens: lexer.tagged_statement_token_tape("value: 31\\nvalue + 1")',
      "parsed: parser.parse_tagged_token_tape(tokens.source, tokens.rows, tokens.count)",
      "typed_module: typed.typed_tagged_module(",
      "    parsed.module.body.source, parsed.module.body.rows, parsed.module.body.count",
      ")",
      "binding: typed.typed_tagged_binding(typed_module, 0)",
      "expression: typed.typed_tagged_bound_statement(typed_module, 1, binding)",
      "dynamic_module: mir.mir_tagged_module(",
      "    typed_module.source, typed_module.statements, typed_module.count",
      ")",
      "closed: mir.mir_tagged_closed_statement(dynamic_module, 0, 1)",
      "maximum: validation.machine_ir_tagged_statement_stack_maximum(",
      "    closed.instructions.0.kind, closed.instructions.1.kind,",
      "    closed.instructions.2.kind, closed.instructions.3.kind",
      ")",
      "module: mir.mir_assemble_closed_tagged_module(closed, maximum)",
      ":: module.schema",
      ":: module.version",
      ":: module.output_kind",
      ":: module.output_count",
      ":: module.entry.name",
      ":: module.entry.parameters.length()",
      ":: module.entry.locals.length()",
      ":: module.entry.max_stack",
      ":: module.entry.instructions.0.kind",
      ":: module.entry.instructions.0.value",
      ":: module.entry.instructions.1.kind",
      ":: module.entry.instructions.1.value",
      ":: module.entry.instructions.2.kind",
      ":: module.entry.instructions.3.kind",
      ":: module.functions.length()",
      ":: module.outputs.length()",
      ":: module.output_tokens.length()",
      ":: module.string_data.length()",
      "",
    ].join("\n"), "utf8");
    compile(source, artifact);

    const expected = [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "0", "0", "2",
      "push_f64", "31", "push_f64", "1", "add_f64", "return_f64", "0", "0", "0", "0",
    ].join(newline) + newline;
    const oracle = join(work, "oracle.txt");
    writeFileSync(oracle, expected, "utf8");

    const output = join(work, `closed${suffix}`);
    const provenance = join(work, "provenance.json");
    const dispatched = spawnSync(
      compiler,
      [
        "--vkf-internal-stage-component", component, artifact, source,
        oracle, output, provenance,
      ],
      { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    assert.equal(dispatched.error, undefined, `dispatch did not start: ${dispatched.error}`);
    assert.equal(dispatched.status, 0, dispatched.stderr);
    assert.equal(existsSync(output), true);

    const executed = spawnSync(output, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, `32${newline}`);

    const receipt = JSON.parse(readFileSync(provenance, "utf8"));
    assert.equal(receipt.component, component);
    assert.equal(receipt.consumer, "vkf_x64_backend.machine_ir");
    assert.equal(receipt.exact_oracle_match, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
