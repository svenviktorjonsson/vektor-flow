import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

function produce(producer, sourcePath, template, output, byteRoot, cwd) {
  return spawnSync(producer, [], {
    cwd,
    encoding: "utf8",
    input: `${sourcePath}\n${template}\n${output}\n${byteRoot}\n`,
    timeout: 5_000,
    windowsHide: true,
  });
}

test("source-produced compiler graph function executes source-responsively", {
  skip: process.platform !== "win32",
}, () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-x64-compiler-function-"));
  try {
    for (const name of ["compiler", "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation", "pe_x64"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const byteRoot = join(work, "bytes");
    mkdirSync(byteRoot);
    for (let value = 128; value < 256; ++value) writeFileSync(join(byteRoot, `${value}.bin`), Buffer.from([value]));
    const highBytes = Array.from({ length: 128 }, (_, index) => `    io.read_bytes(byte_root & "/${index + 128}.bin")`);
    const producerSource = join(work, "producer.vkf");
    const producer = join(work, `producer${suffix}`);
    writeFileSync(producerSource, [
      "compiler: .compiler", "machine: .machine_ir", "pe: .pe_x64", "io: .io",
      "source: io.read_text(io.read_line())", "template: io.read_bytes(io.read_line())",
      "output: io.read_line()", "byte_root: io.read_line()", "[str] high_bytes: [",
      highBytes.join(",\n"), "]",
      "function: compiler._bootstrap_record_function_machine(source)",
      "body: machine._bootstrap_x64_borrowed_scalar_function(function.opcodes, function.operands, function.parameter_starts.length(), function.max_stack, true)",
      "entry: machine._bootstrap_x64_string_list_count_entry(11, 2, true)",
      "linked: machine._bootstrap_x64_compose_function_bytes(entry.bytes & body.bytes, [entry.bytes.length(), body.bytes.length()], [0, 0], [entry.relocation_offset, entry.second_relocation_offset], [1, 1])",
      "image: pe.materialize_composed_callable_code_section(template, linked.bytes, 0, high_bytes)",
      "io.write_bytes(output, image.artifact)",
      ":: function.valid", ":: body.valid", ":: entry.valid", ":: linked.valid",
      ":: function.opcodes", ":: function.operands", ":: body.bytes",
      ":: entry.relocation_offset", ":: entry.second_relocation_offset", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", producerSource, "-o", producer, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);

    const compilerSource = readFileSync(join(root, "compiler/self_hosted/compiler.vkf"), "utf8").replace(/\r\n/g, "\n");
    const baseline = compilerSource.match(/^_compile_locked_valid_source_graph\(sources:\[str\]\):\n[^\n]+/m)?.[0];
    assert.ok(baseline);
    const changed = baseline.replace("sources.length())", "sources.length() + 1)");
    assert.notEqual(changed, baseline);
    const baselineSource = join(work, "baseline.vkf");
    const changedSource = join(work, "changed.vkf");
    writeFileSync(baselineSource, `${baseline}\n`);
    writeFileSync(changedSource, `${changed}\n`);
    const template = join(bin, `vkf_x64_runner_template${suffix}`);
    const first = join(work, "successor-a.exe");
    const repeat = join(work, "successor-b.exe");
    const mutated = join(work, "successor-mutated.exe");
    const firstProduce = produce(producer, baselineSource, template, first, byteRoot, work);
    const repeatProduce = produce(producer, baselineSource, template, repeat, byteRoot, work);
    const changedProduce = produce(producer, changedSource, template, mutated, byteRoot, work);
    for (const result of [firstProduce, repeatProduce, changedProduce]) {
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdout.trimEnd().split(/\r?\n/).slice(0, 4), ["true", "true", "true", "true"]);
    }
    assert.deepEqual(readFileSync(first), readFileSync(repeat));
    assert.notDeepEqual(readFileSync(mutated), readFileSync(first));
    assert.notDeepEqual(firstProduce.stdout.trimEnd().split(/\r?\n/)[5], changedProduce.stdout.trimEnd().split(/\r?\n/)[5]);
    const producedLines = firstProduce.stdout.trimEnd().split(/\r?\n/);
    assert.ok(Number(producedLines[8]) > Number(producedLines[7]));
    for (const [artifact, output] of [[first, "11"], [repeat, "11"], [mutated, "12"]]) {
      const run = spawnSync(artifact, [], { cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      assert.equal(run.stdout.trim(), output);
    }
    assert.doesNotMatch(readFileSync(producerSource, "utf8"), /self_path|run_native|read_bytes\(output\)/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
