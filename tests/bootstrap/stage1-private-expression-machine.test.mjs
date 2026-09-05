import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private expression lowering matches unoptimized native Machine IR", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-expression-machine-"));
  try {
    for (const name of ["lexer", "parser", "typed_ir", "machine_ir"]) {
      const source = name === "machine_ir" && process.env.VKF_BOOTSTRAP_MACHINE_SOURCE
        ? resolve(process.env.VKF_BOOTSTRAP_MACHINE_SOURCE) : join(root, `compiler/self_hosted/${name}.vkf`);
      copyFileSync(source, join(work, `${name}.vkf`));
    }
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "lexer: .lexer", "parser: .parser", "typed: .typed_ir", "machine: .machine_ir", "io: .io",
      "same_operands(values:[num]):",
      "    count: vkf_decimal_parse(io.read_line())",
      "    count != values.length()?", "        @: false",
      "    index: 0", "    same: true",
      "    (index < count)?>",
      "        expected: vkf_decimal_parse(io.read_line())",
      "        values.(index) != expected? .same: false",
      "        .index+: 1",
      "    same",
      "source: io.read_text(io.read_line())", "tape: lexer.tagged_numeric_function_token_tape(source)",
      "shape: parser._bootstrap_record_function_shape(source, tape.rows, tape.count)",
      "tree: parser._bootstrap_expression_tree(source, tape.rows, tape.count, shape.expression_starts.0, shape.expression_stops.0)",
      "facts: typed._bootstrap_expression_types(source, tape.rows, tree.nodes, tree.arguments, shape.parameter_starts, shape.parameter_stops, shape.type_starts, shape.type_stops)",
      "fragment: machine._bootstrap_lower_expression(source, tape.rows, tree.nodes, facts.types, facts.parameters, shape.type_starts, shape.type_stops)",
      ":: fragment.valid", ":: fragment.error_index", ":: fragment.opcodes", ":: same_operands(fragment.operands)", ":: fragment.max_stack", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    for (const { header, expression, argumentsSource, originalSource = "values", ownershipPending = false } of [
      { header: "constant(values:[num]):", expression: "7", argumentsSource: "[1, 2]" },
      { header: "sum(values:[num]):", expression: "values.length()+1+4", argumentsSource: "[1, 2]" },
      { header: "grouped(values:[num]):", expression: "((values.length()))+(values.length()+3)", argumentsSource: "[1, 2]" },
      { header: "strings(values:[ str ]):", expression: "values.length()+1", argumentsSource: '["a", "b"]' },
      { header: "mixed(left:[str], right:[num]):", expression: "right.length()+left.length()", argumentsSource: '["a"], [1, 2]', originalSource: "left" },
      { header: "flags(values:[bit]):", expression: "(values.length)()+1", argumentsSource: "[true, false]" },
      { header: "folded(values:[num]):", expression: "2.5+1+4", argumentsSource: "[1, 2]" },
      { header: "fraction(values:[num]):", expression: "0.1+0.2", argumentsSource: "[1, 2]" },
      { header: "left_order(values:[num]):", expression: "9007199254740992+1+1", argumentsSource: "[1, 2]" },
      { header: "group_order(values:[num]):", expression: "9007199254740992+(1+1)", argumentsSource: "[1, 2]" },
      { header: "subtree(values:[num]):", expression: "values.length()+(2+3)", argumentsSource: "[1, 2]" },
      { header: "returned(values:[num]):", expression: "values", argumentsSource: "[1, 2]", ownershipPending: true },
    ]) {
      const input = join(work, "input.vkf"), oracle = join(work, "oracle.vkf");
      writeFileSync(input, `${header}\n    (value:${expression}, original:${originalSource})\n`);
      // A scalar-return wrapper isolates this expression's native instruction
      // fragment; neither this oracle artifact nor the emitted IR is executed.
      const functionName = header.slice(0, header.indexOf("("));
      writeFileSync(oracle, `${header}\n    ${expression}\n:: ${functionName}(${argumentsSource})\n`);
      const compiled = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", oracle, "-o", join(work, `oracle${suffix}`), "--diagnostics", "--optimizer-policy", "mask-0"], {
        cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      const diagnostic = JSON.parse(compiled.stdout);
      assert.equal(diagnostic.artifact_fallback, false);
      assert.equal(diagnostic.ran, false);
      const expected = JSON.parse(readFileSync(join(work, ".vkfbuild/oracle/machine-ir.json"), "utf8")).functions
        .find((item) => item.name === functionName);
      assert.ok(expected);
      assert.equal(expected.instructions.at(-1).kind, "return_f64");
      const exact = spawnSync(join(bin, `vkf_private_machine_operands${suffix}`), [
        join(work, ".vkfbuild/oracle/typed-ir.json"), functionName,
      ], { cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true });
      assert.equal(exact.status, 0, exact.error?.message ?? exact.stderr);
      assert.equal(exact.stderr, "");
      const [nativeJson, ...oracleDecimals] = exact.stdout.trimEnd().split(/\r?\n/);
      // Independently prove this in-memory lowering has the strict compiler's
      // exact public structure and metadata, including its rounded JSON values.
      assert.deepEqual(JSON.parse(nativeJson), expected);
      const oracleOperands = oracleDecimals.map(Number);
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${input}\n${oracleOperands.length}\n${oracleDecimals.join("\n")}\n`,
        timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const lines = run.stdout.trimEnd().split(/\r?\n/);
      if (ownershipPending) {
        assert.deepEqual(expected.instructions, [{ kind: "load_local", index: 0 }, { kind: "clone_f64_list" }, { kind: "return_f64" }]);
        assert.equal(lines[0], "false", "a borrowed load is not an owned vector return");
        continue;
      }
      assert.equal(lines[0], "true", run.stdout);
      // Both VKF display and public MIR JSON are lossy. Compare native in-memory
      // operands at max_digits10 exactly inside VKF; no numeric tolerance.
      assert.equal(lines[3], "true", `exact operand equality failed: ${expression}; ${run.stdout}`);
      const opcodes = JSON.parse(lines[2]), operands = oracleOperands;
      assert.equal(opcodes.length, operands.length);
      const instructions = opcodes.map((opcode, index) => {
        if (opcode === 2) return { kind: "load_local", index: operands[index] };
        if (opcode === 3) return { kind: "count_f64_list", owns_input: false };
        if (opcode === 4) return { kind: "divide_f64" };
        if (opcode === 5) return { kind: "add_f64" };
        assert.equal(opcode, 1);
        return { kind: "push_f64", value: operands[index] };
      });
      const exactInstructions = expected.instructions.map((instruction, index) =>
        instruction.kind === "push_f64" ? { ...instruction, value: oracleOperands[index] } : instruction);
      assert.deepEqual([...instructions, { kind: "return_f64" }], exactInstructions, run.stdout);
      assert.equal(Number(lines[4]), expected.max_stack);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
