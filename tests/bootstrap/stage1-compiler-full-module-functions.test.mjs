import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const compiler = join(nativeBin, `vkf-strict${suffix}`);

test("compiler source retains every non-entry module function", () => {
  const rootWork = join(root, ".work");
  mkdirSync(rootWork, { recursive: true });
  const work = mkdtempSync(join(rootWork, "i147-full-module-functions-"));
  try {
    for (const name of [
      "compiler",
      "lexer",
      "parser",
      "typed_ir",
      "machine_ir",
      "machine_ir_validation",
    ]) {
      copyFileSync(
        join(root, "compiler", "self_hosted", `${name}.vkf`),
        join(work, `${name}.vkf`),
      );
    }
    const moduleSource = Array.from(
      { length: 32 },
      (_, index) => `value${index}+${index + 1}`,
    ).join("\n");
    const source = join(work, "producer.vkf");
    const artifact = join(work, `producer${suffix}`);
    writeFileSync(source, [
      "stage: .compiler",
      `module: stage.compile_tagged_module_statement(${JSON.stringify(moduleSource)}, 31)`,
      ":: module.entry.name",
      ":: module.functions.length()",
      ":: module.functions.0.name",
      ":: module.functions.30.name",
      "",
    ].join("\n"), "utf8");
    const compiled = spawnSync(
      compiler,
      [
        "-b",
        source,
        "-o",
        artifact,
        "--diagnostics",
        "--optimizer-policy",
        "mask-0",
      ],
      { cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true },
    );
    assert.equal(compiled.status, 0, compiled.error?.message ?? compiled.stderr);
    const executed = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), [
      "value31",
      "31",
      "value0",
      "value30",
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
