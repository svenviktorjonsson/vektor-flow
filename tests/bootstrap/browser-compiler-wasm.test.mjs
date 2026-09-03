import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSymbolicKernel } from "../../web/vf-ui/vf-symbolic-kernel-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeBin = process.env.VKF_NATIVE_BIN;

test("browser compiler turns VKF source into validated machine IR inside WASM", async () => {
  assert.ok(nativeBin, "VKF_NATIVE_BIN must name the focused native build directory");
  const work = await mkdtemp(path.join(tmpdir(), "vkf-browser-compiler-"));
  try {
    const built = spawnSync(
      process.execPath,
      ["tools/build-browser-compiler.mjs", "--output", work],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, VKF_NATIVE_BIN: path.resolve(nativeBin) },
        windowsHide: true,
        timeout: 180_000,
      },
    );
    assert.equal(built.status, 0, built.stderr || built.stdout);

    const [wasm, manifest] = await Promise.all([
      readFile(path.join(work, "vkf-browser-compiler.wasm")),
      readFile(path.join(work, "vkf-browser-compiler.json"), "utf8").then(JSON.parse),
    ]);
    const { instance } = await WebAssembly.instantiate(wasm);
    const compiler = createSymbolicKernel({ instance, manifest });
    assert.deepEqual(
      { ...compiler.invokeValue("compile_tagged_dependency_tape", [
        "base: 40\nfirst: base + 1\nsecond: first + 1\nsecond + 1",
      ]) },
      {
        name: "$entry",
        opcodes: [1, 1, 2, 1, 2, 1, 2, 3],
        values: [40, 1, 0, 1, 0, 1, 0, 0],
        max_stack: 2,
      },
    );
    assert.equal(
      compiler.invokeValue("run_tagged_dependency_source", [
        "base: 40\nfirst: base + 1\nsecond: first + 1\nsecond + 1",
      ]),
      43,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
