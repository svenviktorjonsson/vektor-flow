import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

test("private source-derived vector length function matches native x64 bytes", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-x64-vector-length-"));
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
      `encoded: machine._bootstrap_x64_borrowed_scalar_function(function.opcodes, function.operands, function.parameter_starts.length(), function.max_stack, ${process.platform === "win32" ? "true" : "false"})`,
      ":: function.valid", ":: encoded.valid", ":: encoded.bytes", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);
    const encodedFunctions = new Map();
    for (const [source, name, invocation, field] of [
      ["measure(items:[num]):\n    (count:items.length(),)\n", "measure", "measure([1, 2])", "count"],
      ["renamed(left:[num], right:[bit]):\n    (size:right.length(),)\n", "renamed", "renamed([1], [true, false])", "size"],
      ["words(items:[str]):\n    (count:items.length(),)\n", "words", 'words(["a", "bc"])', "count"],
      ["reordered(numbers:[int], names:[str], flags:[bit]):\n    (total:names.length(),)\n", "reordered", 'reordered([1, 2], ["a"], [true])', "total"],
      ["integers(names:[str], numbers:[int]):\n    (amount:numbers.length(),)\n", "integers", 'integers(["a"], [1, 2, 3])', "amount"],
      ["successor(items:[str]):\n    (count:items.length() + 1,)\n", "successor", 'successor(["a", "bc"])', "count"],
      ["offset(numbers:[int], names:[str]):\n    (amount:0.1 + names.length(),)\n", "offset", 'offset([1], ["a", "bc"])', "amount"],
      ["combined(names:[str], values:[num]):\n    (total:names.length() + values.length(),)\n", "combined", 'combined(["a"], [1, 2])', "total"],
      ["nested(flags:[bit], names:[str]):\n    (size:flags.length() + (names.length() + 2),)\n", "nested", 'nested([true], ["a"] )', "size"],
      ["rounded(items:[num]):\n    (count:items.length() + (9007199254740992 + 1),)\n", "rounded", "rounded([1])", "count"],
    ]) {
      const input = join(work, "input.vkf"), oracleSource = join(work, "oracle.vkf");
      writeFileSync(input, source);
      writeFileSync(oracleSource, `${source}result: ${invocation}\n:: result.${field}\n`);
      const compiled = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", oracleSource, "-o", join(work, `oracle${suffix}`), "--diagnostics", "--optimizer-policy", "mask-0"], {
        cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      const diagnostic = JSON.parse(compiled.stdout);
      assert.equal(diagnostic.artifact_fallback, false);
      assert.equal(diagnostic.ran, false);
      const expectedFunction = JSON.parse(readFileSync(join(work, ".vkfbuild/oracle/machine-ir.json"), "utf8")).functions.find((fn) => fn.name === name);
      const oracle = spawnSync(join(bin, `vkf_private_x64_prefix${suffix}`), ["--function", join(work, ".vkfbuild/oracle/typed-ir.json"), name], {
        cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
      });
      assert.equal(oracle.status, 0, oracle.error?.message ?? oracle.stderr);
      assert.equal(oracle.stderr, "");
      const [functionJson, bytesJson] = oracle.stdout.trimEnd().split(/\r?\n/);
      assert.deepEqual(JSON.parse(functionJson), expectedFunction);
      const run = spawnSync(artifact, [], {
        cwd: work, encoding: "utf8", input: `${input}\n`, timeout: 3_000, windowsHide: true,
      });
      assert.equal(run.status, 0, run.error?.message ?? run.stderr);
      assert.equal(run.stderr, "");
      const [parsed, valid, bytes] = run.stdout.trimEnd().split(/\r?\n/);
      assert.equal(parsed, "true", run.stdout);
      assert.equal(valid, "true", run.stdout);
      assert.deepEqual(JSON.parse(bytes), JSON.parse(bytesJson));
      encodedFunctions.set(name, JSON.parse(bytes));
    }
    assert.notDeepEqual(encodedFunctions.get("successor"), encodedFunctions.get("words"), "length()+1 must change emitted function bytes");
    // Invalid private inputs publish no partial code. These are validation
    // results, not new public VKF diagnostics or executable-code tests.
    const rejected = [
      ["[]", "[]", 1, 1],
      ["[2, 3, 8]", "[0, 0]", 1, 1],
      ["[2, 3, 8]", "[0, 0, 0]", 0, 1],
      ["[2, 3, 8]", "[0, 0, 0]", 1.5, 1],
      ["[2, 3, 8]", "[0, 0, 0]", 1, 0],
      ["[2, 3, 8]", "[0, 0, 0]", 1, 1.5],
      ["[2, 3, 8]", "[0, 0, 0]", 1, 268435456],
      ["[2, 3, 8]", "[-1, 0, 0]", 1, 1],
      ["[2, 3, 8]", "[1, 0, 0]", 1, 1],
      ["[2, 3, 8]", "[0.5, 0, 0]", 1, 1],
      ["[2, 3, 8]", "[0, 1, 0]", 1, 1],
      ["[2, 3, 8]", "[0, 0, 1]", 1, 1],
      ["[3, 8]", "[0, 0]", 1, 1],
      ["[2, 8]", "[0, 0]", 1, 1],
      ["[1, 3, 8]", "[2, 0, 0]", 1, 1],
      ["[1, 8]", "[2, 0]", 1, 1],
      ["[2, 3]", "[0, 0]", 1, 1],
      ["[2, 3, 8, 1]", "[0, 0, 0, 2]", 1, 1],
      ["[2, 3, 2, 8]", "[0, 0, 0, 0]", 1, 2],
      ["[2, 3, 1, 4, 8]", "[0, 0, 2, 0, 0]", 1, 1],
      ["[2, 3, 4, 8]", "[0, 0, 0, 0]", 1, 2],
      ["[2, 3, 2, 4, 8]", "[0, 0, 0, 0, 0]", 1, 2],
      ["[2, 2, 3, 4, 8]", "[0, 0, 0, 0, 0]", 1, 2],
      ["[2, 3, 1, 4, 8]", "[0, 0, 2, 1, 0]", 1, 2],
      ["[2, 3, 1, 4, 8]", "[0, 0, null, 0, 0]", 1, 2],
      ["[2, 3, 5, 8]", "[0, 0, 0, 0]", 1, 2],
      ["[2, 3, 2, 5, 8]", "[0, 0, 0, 0, 0]", 1, 2],
      ["[2, 2, 3, 5, 8]", "[0, 0, 0, 0, 0]", 1, 2],
      ["[2, 3, 1, 5, 8]", "[0, 0, 1, 1, 0]", 1, 2],
      ["[2, 3, 1, 5, 8]", "[0, 0, 1, 0, 0]", 1, 1],
      ["[2, 3, 6, 8]", "[0, 0, 0, 0]", 1, 1],
      ["[2, 3, 7]", "[0, 0, 1]", 1, 1],
    ];
    writeFileSync(probe, ["machine: .machine_ir", ...rejected.flatMap(([codes, values, parameters, maximum], index) => [
      `r${index}: machine._bootstrap_x64_borrowed_scalar_function(${codes}, ${values}, ${parameters}, ${maximum}, ${process.platform === "win32" ? "true" : "false"})`,
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
