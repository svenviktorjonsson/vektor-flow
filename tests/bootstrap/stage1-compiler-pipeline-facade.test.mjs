import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("compiler source composes the existing frontend and validated MIR phases", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i136-compiler-pipeline-"));
  try {
    for (const name of [
      "compiler", "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation",
    ]) {
      copyFileSync(join(root, "compiler", "self_hosted", `${name}.vkf`), join(work, `${name}.vkf`));
    }
    const source = join(work, "producer.vkf");
    const artifact = join(work, `producer${suffix}`);
    writeFileSync(source, [
      "stage: .compiler",
      'statement: stage.compile_tagged_dependency_tape("base: 30\\nfirst: base + 1\\nsecond: first + 1\\nsecond + 1")',
      ':: "vektorflow.machine_ir"', ":: 4", ':: "f64"', ":: 1",
      ":: statement.name", ":: statement.max_stack", ":: statement.opcodes.length()",
      ":: statement.opcodes", ":: statement.values", "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);

    const expected = [
      "vektorflow.machine_ir", "4", "f64", "1", "$entry", "2", "8",
      "[1, 1, 2, 1, 2, 1, 2, 3]", "[30, 1, 0, 1, 0, 1, 0, 0]",
    ].join(newline) + newline;
    const observed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(observed.status, 0, observed.stderr);
    assert.equal(observed.stdout, expected);

    const oracle = join(work, "oracle.txt");
    writeFileSync(oracle, expected, "utf8");
    const output = join(work, `compiled${suffix}`);
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
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
