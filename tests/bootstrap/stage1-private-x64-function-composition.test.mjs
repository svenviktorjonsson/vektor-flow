import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bin = resolve(process.env.VKF_NATIVE_BIN ?? join(root, "build/native-windows/bin"));
const suffix = process.platform === "win32" ? ".exe" : "";

function patchRel32(bytes, reference, target) {
  let value = target - reference - 4;
  if (value < 0) value += 0x1_0000_0000;
  for (let index = 0; index < 4; ++index) {
    bytes[reference + index] = Math.floor(value / 2 ** (index * 8)) % 256;
  }
}

test("private source-produced functions compose through symbolic call relocations", () => {
  const workRoot = resolve(process.env.VKF_TEST_WORK_ROOT ?? join(root, "build/bootstrap-tests"));
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "private-x64-function-composition-"));
  try {
    for (const name of ["compiler", "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation", "pe_x64"]) {
      copyFileSync(join(root, `compiler/self_hosted/${name}.vkf`), join(work, `${name}.vkf`));
    }
    copyFileSync(join(root, "compiler/self_hosted/stdlib/io.vkf"), join(work, "io.vkf"));
    const probe = join(work, "probe.vkf"), artifact = join(work, `probe${suffix}`);
    writeFileSync(probe, [
      "compiler: .compiler", "machine: .machine_ir", "io: .io",
      "first_source: io.read_text(io.read_line())", "second_source: io.read_text(io.read_line())",
      "first_function: compiler._bootstrap_record_function_machine(first_source)",
      "second_function: compiler._bootstrap_record_function_machine(second_source)",
      `first: machine._bootstrap_x64_borrowed_string_record_function(first_function.opcodes, first_function.operands, first_function.parameter_starts.length(), first_function.max_stack, ${process.platform === "win32" ? "true" : "false"}, true)`,
      `second: machine._bootstrap_x64_borrowed_string_record_function(second_function.opcodes, second_function.operands, second_function.parameter_starts.length(), second_function.max_stack, ${process.platform === "win32" ? "true" : "false"}, true)`,
      "caller: [232, 0, 0, 0, 0, 232, 0, 0, 0, 0, 195]",
      "composed: machine._bootstrap_x64_compose_function_bytes(first.bytes & second.bytes & caller, [first.bytes.length(), second.bytes.length(), caller.length()], [2, 2], [1, 6], [0, 1])",
      ":: first_function.valid", ":: second_function.valid", ":: first.valid", ":: second.valid",
      ":: first.bytes", ":: second.bytes", ":: composed.valid", ":: composed.positions", ":: composed.bytes", "",
    ].join("\n"));
    const built = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(built.status, 0, built.error?.message ?? built.stderr);

    const compilerSource = readFileSync(join(root, "compiler/self_hosted/compiler.vkf"), "utf8").replace(/\r\n/g, "\n");
    const artifactResult = compilerSource.match(/^artifact_result\(manifest_path:str, artifact_path:str, status:str\):\n[^\n]+/m)?.[0];
    const manifestStart = compilerSource.indexOf("\nmanifest(\n");
    const manifestStop = compilerSource.indexOf("\n\nartifact_result(", manifestStart);
    assert.ok(artifactResult && manifestStart >= 0 && manifestStop > manifestStart);
    const firstInput = join(work, "artifact-result.vkf"), secondInput = join(work, "manifest.vkf");
    writeFileSync(firstInput, `${artifactResult}\n`);
    writeFileSync(secondInput, `${compilerSource.slice(manifestStart + 1, manifestStop)}\n`);
    const run = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", input: `${firstInput}\n${secondInput}\n`, timeout: 3_000, windowsHide: true,
    });
    assert.equal(run.status, 0, run.error?.message ?? run.stderr);
    assert.equal(run.stderr, "");
    const lines = run.stdout.trimEnd().split(/\r?\n/);
    assert.deepEqual(lines.slice(0, 4), ["true", "true", "true", "true"], run.stdout);
    const first = JSON.parse(lines[4]), second = JSON.parse(lines[5]);
    assert.equal(lines[6], "true", run.stdout);
    const positions = [0, first.length, first.length + second.length];
    assert.deepEqual(JSON.parse(lines[7]), positions);
    const expected = [...first, ...second, 232, 0, 0, 0, 0, 232, 0, 0, 0, 0, 195];
    patchRel32(expected, positions[2] + 1, positions[0]);
    patchRel32(expected, positions[2] + 6, positions[1]);
    assert.deepEqual(JSON.parse(lines[8]), expected);

    const rejected = [
      ["[]", "[]", "[]", "[]", "[]"],
      ["[195]", "[1]", "[0]", "[]", "[0]"],
      ["[195]", "[2]", "[]", "[]", "[]"],
      ["[256]", "[1]", "[]", "[]", "[]"],
      ["[195]", "[0.5]", "[]", "[]", "[]"],
      ["[232,0,0,0,0,195]", "[6]", "[1]", "[1]", "[0]"],
      ["[232,0,0,0,0,195]", "[6]", "[0]", "[1]", "[1]"],
      ["[232,0,0,0,0,195]", "[6]", "[0]", "[0]", "[0]"],
      ["[232,0,0,0,0,195]", "[6]", "[0]", "[3]", "[0]"],
      ["[231,0,0,0,0,195]", "[6]", "[0]", "[1]", "[0]"],
      ["[232,1,0,0,0,195]", "[6]", "[0]", "[1]", "[0]"],
      ["[232,0,0,0,0,195]", "[6]", "[0,0]", "[1,1]", "[0,0]"],
    ];
    writeFileSync(probe, ["machine: .machine_ir", ...rejected.flatMap((args, index) => [
      `r${index}: machine._bootstrap_x64_compose_function_bytes(${args.join(", ")})`,
      `:: r${index}.valid`, `:: r${index}.positions`, `:: r${index}.bytes`,
    ]), ""].join("\n"));
    const checked = spawnSync(join(bin, `vkf-strict${suffix}`), ["-b", probe, "-o", artifact, "--optimizer-policy", "mask-0"], {
      cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true,
    });
    assert.equal(checked.status, 0, checked.error?.message ?? checked.stderr);
    const invalid = spawnSync(artifact, [], { cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true });
    assert.equal(invalid.status, 0, invalid.error?.message ?? invalid.stderr);
    assert.equal(invalid.stderr, "");
    const invalidLines = invalid.stdout.trimEnd().split(/\r?\n/);
    assert.deepEqual(invalidLines.filter((_, index) => index % 3 === 0), rejected.map(() => "false"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
