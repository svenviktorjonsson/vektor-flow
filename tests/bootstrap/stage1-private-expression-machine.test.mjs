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
    for (const name of ["lexer", "parser", "typed_ir", "machine_ir"]) copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "lexer: .lexer", "parser: .parser", "typed: .typed_ir", "machine: .machine_ir", "io: .io",
      "source: io.read_text(io.read_line())", "tape: lexer.tagged_numeric_function_token_tape(source)",
      "shape: parser._bootstrap_record_function_shape(source, tape.rows, tape.count)",
      "tree: parser._bootstrap_expression_tree(source, tape.rows, tape.count, shape.expression_starts.0, shape.expression_stops.0)",
      "facts: typed._bootstrap_expression_types(source, tape.rows, tree.nodes, tree.arguments, shape.parameter_starts, shape.parameter_stops, shape.type_starts, shape.type_stops)",
      "fragment: machine._bootstrap_lower_expression(source, tape.rows, tree.nodes, facts.types, facts.parameters, shape.type_starts, shape.type_stops)",
      ":: fragment.valid", ":: fragment.error_index", ":: fragment.opcodes", ":: fragment.operands", ":: fragment.max_stack", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    for (const { header, expression, argumentsSource, originalSource = "values", foldingPending = false, ownershipPending = false } of [
      { header: "constant(values:[num]):", expression: "7", argumentsSource: "[1, 2]" },
      // Constant-only addition has a separate native mask-0 folding boundary.
      // Runtime length operands keep this packet structural and non-evaluating.
      { header: "sum(values:[num]):", expression: "values.length()+1+4", argumentsSource: "[1, 2]" },
      { header: "grouped(values:[num]):", expression: "((values.length()))+(values.length()+3)", argumentsSource: "[1, 2]" },
      { header: "strings(values:[ str ]):", expression: "values.length()+1", argumentsSource: '["a", "b"]' },
      { header: "mixed(left:[str], right:[num]):", expression: "right.length()+left.length()", argumentsSource: '["a"], [1, 2]', originalSource: "left" },
      { header: "flags(values:[bit]):", expression: "(values.length)()+1", argumentsSource: "[true, false]" },
      { header: "folded(values:[num]):", expression: "2.5+1+4", argumentsSource: "[1, 2]", foldingPending: true },
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
      const run = spawnSync(artifact, [], { cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const lines = run.stdout.trimEnd().split(/\r?\n/);
      if (foldingPending) {
        assert.deepEqual(expected.instructions, [{ kind: "push_f64", value: 7.5 }, { kind: "return_f64" }]);
        assert.equal(lines[0], "false", "constant-only folding must remain explicitly unsupported, not emit non-native MIR");
        continue;
      }
      if (ownershipPending) {
        assert.deepEqual(expected.instructions, [{ kind: "load_local", index: 0 }, { kind: "clone_f64_list" }, { kind: "return_f64" }]);
        assert.equal(lines[0], "false", "a borrowed load is not an owned vector return");
        continue;
      }
      assert.equal(lines[0], "true", run.stdout);
      const opcodes = JSON.parse(lines[2]), operands = JSON.parse(lines[3]);
      assert.equal(opcodes.length, operands.length);
      const instructions = opcodes.map((opcode, index) => {
        if (opcode === 2) return { kind: "load_local", index: operands[index] };
        if (opcode === 3) return { kind: "count_f64_list", owns_input: false };
        if (opcode === 4) return { kind: "divide_f64" };
        if (opcode === 5) return { kind: "add_f64" };
        assert.equal(opcode, 1);
        return { kind: "push_f64", value: operands[index] };
      });
      assert.deepEqual([...instructions, { kind: "return_f64" }], expected.instructions);
      assert.equal(Number(lines[4]), expected.max_stack);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
