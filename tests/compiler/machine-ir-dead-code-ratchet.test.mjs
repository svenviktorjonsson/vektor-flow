import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeDriver = process.env.VKF_NATIVE_DRIVER;
const workRoot = path.join(repositoryRoot, ".work", `machine-ir-ratchet-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

test("strict native artifacts preserve complex arithmetic", async () => {
  assert.ok(nativeDriver, "VKF_NATIVE_DRIVER must name the focused strict native driver");
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "complex.vkf");
  const artifact = path.join(workRoot, process.platform === "win32" ? "complex.exe" : "complex");
  await writeFile(source, "squared: num(2, 3) * num(2, 3)\n:: str(squared)\n", "utf8");

  const compiled = spawnSync(nativeDriver, ["-b", source, "-o", artifact], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(compiled.status, 0, compiled.stderr || "strict native compilation failed");

  const executed = spawnSync(artifact, [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(executed.status, 0, executed.stderr || "complex artifact failed");
  assert.equal(executed.stdout.trim(), "-5 + 12i");
});

test("machine IR lowering retains no definition-only complex widener", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "compiler", "native", "vkf_machine_ir_lowering.hpp"),
    "utf8",
  );

  assert.doesNotMatch(source, /inline ValueLayout emit_widen_complex\(/u);
});
