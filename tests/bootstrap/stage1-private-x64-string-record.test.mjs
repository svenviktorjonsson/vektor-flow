import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private compiler string-record function matches native x64 bytes", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-x64-string-record-"));
  try {
    for (const name of ["compiler", "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation", "pe_x64"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "compiler: .compiler", "machine: .machine_ir", "io: .io",
      "source: io.read_text(io.read_line())",
      "function: compiler._bootstrap_record_function_machine(source)",
      `encoded: machine._bootstrap_x64_borrowed_string_record_function(function.opcodes, function.operands, function.parameter_starts.length(), function.max_stack, ${process.platform === "win32" ? "true" : "false"}, true)`,
      ":: function.valid", ":: encoded.valid", ":: encoded.bytes", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);

    const compilerSource = readFileSync(join(root, "compiler/self_hosted/compiler.vkf"), "utf8").replace(/\r\n/g, "\n");
    const artifactResult = compilerSource.match(/^artifact_result\(manifest_path:str, artifact_path:str, status:str\):\n[^\n]+/m)?.[0];
    const manifestStart = compilerSource.indexOf("\nmanifest(\n");
    const manifestStop = compilerSource.indexOf("\n\nartifact_result(", manifestStart);
    const manifestFunction = compilerSource.slice(manifestStart + 1, manifestStop);
    assert.ok(artifactResult && manifestStart >= 0 && manifestStop > manifestStart);
    const input = join(work, "input.vkf"), oracleSource = join(work, "oracle.vkf");
    for (const { name, source, invocation } of [
      { name: "artifact_result", source: `${artifactResult}\n`, invocation: 'artifact_result("manifest", "artifact", "ready")' },
      { name: "manifest", source: `${manifestFunction}\n`, invocation: 'manifest("source", "source-hash", "typed-hash", "version", "artifact", "artifact-hash", "runtime-hash", "manifest-hash", "ready")' },
    ]) {
      writeFileSync(input, source);
      writeFileSync(oracleSource, `${source}result: ${invocation}\n:: result.status\n`);
      const compiled = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", oracleSource, "-o", join(work, `oracle${suffix}`), "--diagnostics", "--optimizer-policy", "mask-0"], {
        cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      const diagnostics = JSON.parse(compiled.stdout);
      assert.equal(diagnostics.artifact_fallback, false);
      assert.equal(diagnostics.ran, false);
      const expectedFunction = JSON.parse(readFileSync(join(work, ".vkfbuild/oracle/machine-ir.json"), "utf8")).functions
        .find((fn) => fn.name === name);
      const oracle = spawnSync(join(bin, `vkf_private_x64_prefix${suffix}`), ["--function", join(work, ".vkfbuild/oracle/typed-ir.json"), name], {
        cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(oracle.status, 0, oracle.error?.message ?? oracle.stderr);
      const [functionJson, bytesJson] = oracle.stdout.trimEnd().split(/\r?\n/);
      assert.deepEqual(JSON.parse(functionJson), expectedFunction);
      const run = spawnSync(artifact, [], { cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const [parsed, valid, bytes] = run.stdout.trimEnd().split(/\r?\n/);
      assert.equal(parsed, "true", run.stdout);
      assert.equal(valid, "true", run.stdout);
      assert.deepEqual(JSON.parse(bytes), JSON.parse(bytesJson));
    }

    const rejected = [
      ["[]", "[]", 1, 2],
      ["[2]", "[]", 1, 2],
      ["[2,2,9,7]", "[0,1,0,2]", 0, 2],
      ["[2,2,9,7]", "[0,1,0,2]", 1.5, 2],
      ["[2,2,9,7]", "[0,1,0,2]", 1, 0],
      ["[2,2,9,7]", "[-1,1,0,2]", 1, 2],
      ["[2,2,9,7]", "[0,2,0,2]", 1, 2],
      ["[2,2,9,7]", "[0.5,1,0,2]", 1, 2],
      ["[9,7]", "[0,2]", 1, 2],
      ["[2,2,9,7]", "[0,1,1,2]", 1, 2],
      ["[2,2,9,7]", "[1,0,0,2]", 1, 2],
      ["[2,2,9,7]", "[0,3,0,2]", 2, 2],
      ["[2,2,9,9,7]", "[0,1,0,0,2]", 1, 2],
      ["[2,2,7]", "[0,1,2]", 1, 2],
      ["[2,2,9,7]", "[0,1,0,3]", 1, 2],
      ["[2,2,9,2,2,9,2,2,9,7]", "[0,1,0,2,3,0,4,5,0,6]", 3, 5],
      ["[2,2,9,7,2]", "[0,1,0,2,0]", 1, 2],
      ["[1,7]", "[0,1]", 1, 1],
    ];
    writeFileSync(probe, ["machine: .machine_ir", ...rejected.flatMap(([codes, values, parameters, maximum], index) => [
      `r${index}: machine._bootstrap_x64_borrowed_string_record_function(${codes}, ${values}, ${parameters}, ${maximum}, ${process.platform === "win32" ? "true" : "false"}, true)`,
      `:: r${index}.valid`, `:: r${index}.bytes`,
    ]), ""].join("\n"));
    const checked = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(checked.status, 0, checked.error?.message ?? checked.stderr);
    const invalid = spawnSync(artifact, [], { cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true });
    assert.equal(invalid.status, 0, invalid.error?.message ?? invalid.stderr);
    assert.equal(invalid.stderr, "");
    assert.deepEqual(invalid.stdout.trimEnd().split(/\r?\n/), rejected.flatMap(() => ["false", "[]"]));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
