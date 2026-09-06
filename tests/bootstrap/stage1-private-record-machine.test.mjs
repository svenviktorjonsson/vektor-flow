import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private record producer matches the complete native MachineFunction", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-record-machine-"));
  try {
    for (const name of ["compiler", "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation", "pe_x64"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "compiler: .compiler", "io: .io", "source: io.read_text(io.read_line())",
      "function: compiler._bootstrap_record_function_machine(source)",
      ":: function.valid", ":: function.error_index", ":: function.name", ":: function.opcodes",
      ":: function.operands", ":: function.max_stack", ":: function.parameter_starts", ":: function.parameter_stops", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    const actual = readFileSync(join(root, "compiler/self_hosted/compiler.vkf"), "utf8").replace(/\r\n/g, "\n")
      .match(/^_compile_locked_valid_source_graph\(sources:\[str\]\):\n[^\n]+/m)?.[0];
    assert.ok(actual);
    const artifactResult = readFileSync(join(root, "compiler/self_hosted/compiler.vkf"), "utf8").replace(/\r\n/g, "\n")
      .match(/^artifact_result\(manifest_path:str, artifact_path:str, status:str\):\n[^\n]+/m)?.[0];
    assert.ok(artifactResult);
    const compilerSource = readFileSync(join(root, "compiler/self_hosted/compiler.vkf"), "utf8").replace(/\r\n/g, "\n");
    const manifestStart = compilerSource.indexOf("\nmanifest(\n");
    const manifestStop = compilerSource.indexOf("\n\nartifact_result(", manifestStart);
    const manifestFunction = compilerSource.slice(manifestStart + 1, manifestStop);
    assert.ok(manifestStart >= 0 && manifestStop > manifestStart);
    for (const { source, invocation, field } of [
      { source: `${actual}\n`, invocation: '_compile_locked_valid_source_graph(["a", "b"])', field: "source_count" },
      { source: `${actual.replace("sources.length()", "sources.length()+1")}\n`, invocation: '_compile_locked_valid_source_graph(["a", "b"])', field: "source_count" },
      { source: "reordered(left:[num], right:[str]):\n    (count:right.length()+left.length(), saved:(right), first:left)\n", invocation: 'reordered([1, 2], ["a"])', field: "count" },
      { source: "single(items:[num]):\n    (count:items.length(),)\n", invocation: "single([1, 2])", field: "count" },
      { source: "single_vector(items:[num]):\n    (saved:(items),)\n", invocation: "single_vector([1, 2])", field: "saved" },
      { source: "constants(items:[int]):\n    (integer:7, decimal:1.0, length:items.length())\n", invocation: "constants([1, 2])", field: "length" },
      { source: "folded(items:[num]):\n    (first:2.5+1+4, mixed:items.length()+(2+3), original:items)\n", invocation: "folded([1, 2])", field: "mixed" },
      { source: `${artifactResult}\n`, invocation: 'artifact_result("manifest", "artifact", "ready")', field: "status" },
      { source: `${manifestFunction}\n`, invocation: 'manifest("source", "source-hash", "typed-hash", "version", "artifact", "artifact-hash", "runtime-hash", "manifest-hash", "ready")', field: "status" },
    ]) {
      const input = join(work, "input.vkf"), oracle = join(work, "oracle.vkf");
      writeFileSync(input, source);
      writeFileSync(oracle, `${source}result: ${invocation}\n:: result.${field}\n`);
      const compiled = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", oracle, "-o", join(work, `oracle${suffix}`), "--diagnostics", "--optimizer-policy", "mask-0"], {
        cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      const diagnostics = JSON.parse(compiled.stdout);
      assert.equal(diagnostics.artifact_fallback, false);
      assert.equal(diagnostics.ran, false);
      const expected = JSON.parse(readFileSync(join(work, ".vkfbuild/oracle/machine-ir.json"), "utf8")).functions;
      const run = spawnSync(artifact, [], { cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const lines = run.stdout.trimEnd().split(/\r?\n/);
      assert.equal(lines[0], "true", run.stdout);
      const opcodes = JSON.parse(lines[3]), operands = JSON.parse(lines[4]);
      const starts = JSON.parse(lines[6]), stops = JSON.parse(lines[7]), bytes = Buffer.from(source);
      const parameters = starts.flatMap((start, index) => {
        const name = bytes.subarray(start, stops[index]).toString();
        return bytes.subarray(stops[index], stops[index] + 4).toString() === ":str"
          ? [`${name}.0`, `${name}.1`] : [name];
      });
      assert.equal(opcodes.length, operands.length);
      const instructions = opcodes.map((opcode, index) => {
        if (opcode === 1) return { kind: "push_f64", value: operands[index] };
        if (opcode === 2) return { kind: "load_local", index: operands[index] };
        if (opcode === 3) return { kind: "count_f64_list", owns_input: false };
        if (opcode === 4) return { kind: "divide_f64" };
        if (opcode === 5) return { kind: "add_f64" };
        if (opcode === 6) return { kind: "clone_f64_list" };
        if (opcode === 7) return { kind: "return_values", result_count: operands[index] };
        if (opcode === 8) return { kind: "return_f64" };
        if (opcode === 9) return { kind: "clone_string" };
        assert.fail(`unknown private opcode ${opcode}`);
      });
      assert.deepEqual({
        instructions, name: lines[2], max_stack: Number(lines[5]), parameters, locals: parameters,
        local_classes: parameters.map(() => "f64"), parameter_is_numeric_scalar: parameters.map(() => false),
        owned_f64_list_locals: [], owned_string_locals: [], parameter_mask_local: null,
        may_error: false, result_is_dynamic_f64_list: false, result_is_numeric_scalar: false,
      }, expected.find((fn) => fn.name === lines[2]));
    }
    for (const [source, errorIndex] of [
      ["check(items:[num]):\n    (first:missing, second:other)\n", 13],
      ["check(items:[num]):\n    (first:items, second:missing)\n", 17],
      ["check(items:[num]):\n    (first:2+3, second:missing)\n", 19],
      ["check(items:[num]):\n    (first:items.length(1), second:missing)\n", 16],
      ["check(items:[num]):\n    (first:items)\n", 14],
      ["check(items:[str], items:[num]):\n    (first:missing, second:items)\n", 8],
      ["check(\n    items:[num]\n    other:[num]\n):\n    (first:items, second:other)\n", 9],
      ["check(items:[num]):\n    (first:items\n        .length(), second:items)\n", 15],
    ]) {
      const input = join(work, "invalid.vkf");
      writeFileSync(input, source);
      const run = spawnSync(artifact, [], { cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const lines = run.stdout.trimEnd().split(/\r?\n/);
      assert.equal(lines[0], "false", source);
      assert.equal(Number(lines[1]), errorIndex, source);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
