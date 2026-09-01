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

function runArithmetic({
  sourceText, parserFunction, typedFunction, machineFunction,
  component, expected, expectedStdout, thirdValueBeforeFourth = false,
}) {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i127-nested-addition-"));
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
      `tokens: lexer.tagged_statement_token_tape(${JSON.stringify(sourceText)})`,
      `parsed: parser.${parserFunction}(`,
      "    tokens.source, tokens.rows, tokens.count",
      ")",
      `expression: typed.${typedFunction}(parsed.kind, parsed.values)`,
      `statement: mir.${machineFunction}(expression.values)`,
      "maximum: validation.machine_ir_nested_addition_stack_maximum(",
      "    statement.instructions.0.kind, statement.instructions.1.kind,",
      "    statement.instructions.2.kind, statement.instructions.3.kind,",
      "    statement.instructions.4.kind, statement.instructions.5.kind",
      ")",
      "module: mir.mir_assemble_closed_nested_module(statement, maximum)",
      ":: module.schema",
      ":: module.version",
      ":: module.output_kind",
      ":: module.output_count",
      ":: module.entry.name",
      ":: module.entry.max_stack",
      ":: module.entry.instructions.0.kind",
      ":: module.entry.instructions.0.value",
      ":: module.entry.instructions.1.kind",
      ":: module.entry.instructions.1.value",
      ...(thirdValueBeforeFourth ? [
        ":: module.entry.instructions.2.kind",
        ":: module.entry.instructions.2.value",
        ":: module.entry.instructions.3.kind",
      ] : [
        ":: module.entry.instructions.2.kind",
        ":: module.entry.instructions.3.kind",
        ":: module.entry.instructions.3.value",
      ]),
      ":: module.entry.instructions.4.kind",
      ":: module.entry.instructions.5.kind",
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);

    const oracle = join(work, "oracle.txt");
    writeFileSync(oracle, expected.join(newline) + newline, "utf8");
    const output = join(work, `nested${suffix}`);
    const provenance = join(work, "provenance.json");
    const dispatched = spawnSync(
      compiler,
      [
        "--vkf-internal-stage-component",
        component,
        artifact, source, oracle, output, provenance,
      ],
      { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    assert.equal(dispatched.status, 0, dispatched.stderr);

    const executed = spawnSync(output, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, `${expectedStdout}${newline}`);
    assert.equal(JSON.parse(readFileSync(provenance, "utf8")).exact_oracle_match, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("a prior numeric binding closes and encodes a nested addition", () => {
  runArithmetic({
    sourceText: "value: 31\nvalue + 1 + 2",
    parserFunction: "parse_tagged_binding_nested_addition",
    typedFunction: "typed_tagged_nested_addition",
    machineFunction: "mir_tagged_nested_addition",
    component: "machine_ir.closed_nested_addition.typed_module_pipeline",
    expected: [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "2",
      "push_f64", "31", "push_f64", "1", "add_f64",
      "push_f64", "2", "add_f64", "return_f64",
    ],
    expectedStdout: 34,
  });
});

test("multiplication binds before addition in a closed mixed expression", () => {
  runArithmetic({
    sourceText: "value: 31\nvalue + 1 * 2",
    parserFunction: "parse_tagged_binding_add_multiply",
    typedFunction: "typed_tagged_add_multiply",
    machineFunction: "mir_tagged_add_multiply",
    component: "machine_ir.closed_add_multiply.typed_module_pipeline",
    expected: [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "3",
      "push_f64", "31", "push_f64", "1", "push_f64", "2",
      "multiply_f64", "add_f64", "return_f64",
    ],
    expectedStdout: 33,
    thirdValueBeforeFourth: true,
  });
});

test("subtraction follows addition in a closed mixed expression", () => {
  runArithmetic({
    sourceText: "value: 31\nvalue + 3 - 1",
    parserFunction: "parse_tagged_binding_add_subtract",
    typedFunction: "typed_tagged_add_subtract",
    machineFunction: "mir_tagged_add_subtract",
    component: "machine_ir.closed_add_subtract.typed_module_pipeline",
    expected: [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "2",
      "push_f64", "31", "push_f64", "3", "add_f64",
      "push_f64", "1", "subtract_f64", "return_f64",
    ],
    expectedStdout: 33,
  });
});

test("division binds before addition in a closed mixed expression", () => {
  runArithmetic({
    sourceText: "value: 31\nvalue + 6 / 2",
    parserFunction: "parse_tagged_binding_add_divide",
    typedFunction: "typed_tagged_add_divide",
    machineFunction: "mir_tagged_add_divide",
    component: "machine_ir.closed_add_divide.typed_module_pipeline",
    expected: [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "3",
      "push_f64", "31", "push_f64", "6", "push_f64", "2",
      "divide_f64", "add_f64", "return_f64",
    ],
    expectedStdout: 34,
    thirdValueBeforeFourth: true,
  });
});
