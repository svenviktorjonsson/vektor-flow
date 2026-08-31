import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const defaultNativeBin = process.platform === "win32"
  ? join(root, "build", "050-b00", "bin", "Release")
  : join(root, "build", "050-b00", "bin");
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : defaultNativeBin;
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

test("block scope identity uses refined module-binding layouts", () => {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(join(workRoot, "i96-block-layout-"));
  try {
    const source = join(
      root,
      "tests",
      "bootstrap",
      "fixtures",
      "refined-block-scope-identity.vkf",
    );
    const artifact = join(work, `refined-block-scope-identity${executableSuffix}`);
    const compiled = spawnSync(
      compiler,
      ["-b", source, "-o", artifact, "--optimizer-policy", "mask-0"],
      { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(compiled.error, undefined, `compile did not start: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    if (process.platform === "win32") {
      assert.deepEqual([...readFileSync(artifact).subarray(0, 2)], [0x4d, 0x5a]);
    }

    const executed = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(executed.error, undefined, `artifact did not start: ${executed.error}`);
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
