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

test("compiler source demand-lowers one statement from an unbounded module", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i137-unbounded-compiler-"));
  try {
    for (const name of [
      "compiler", "lexer", "parser", "typed_ir", "machine_ir", "machine_ir_validation",
    ]) {
      copyFileSync(join(root, "compiler", "self_hosted", `${name}.vkf`), join(work, `${name}.vkf`));
    }
    const moduleSource = Array.from(
      { length: 32 }, (_, index) => `value${index}+${index + 1}`,
    ).join("\n");
    const source = join(work, "producer.vkf");
    const artifact = join(work, `producer${suffix}`);
    writeFileSync(source, [
      "stage: .compiler",
      `module: stage.compile_tagged_module_statement(${JSON.stringify(moduleSource)}, 31)`,
      ":: module.schema", ":: module.version", ":: module.output_kind",
      ":: module.entry.name", ":: module.entry.parameters.length()",
      ":: module.entry.parameters.0", ":: module.entry.max_stack",
      ":: module.entry.instructions.0.kind",
      ":: module.entry.instructions.1.value",
      ":: module.entry.instructions.2.kind",
      ":: module.entry.instructions.3.kind",
      ":: module.functions.length()", "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work, encoding: "utf8", timeout: 3_000, windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), [
      "vektorflow.machine_ir", "4", "none", "value31", "1", "num", "2",
      "load_local", "32", "add_f64", "return_f64", "31",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
