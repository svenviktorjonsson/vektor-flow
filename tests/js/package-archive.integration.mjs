import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..", "..");
const npmCli = process.env.npm_execpath;

function runNpm(args, cwd, cache) {
  if (!npmCli) throw new Error("npm_execpath is required for package integration tests");
  return spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
}

test("published archive contains an executable symbolic kernel", async () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-package-"));
  const cache = join(work, ".npm-cache");
  try {
    const packed = runNpm(
      ["pack", "--json", "--pack-destination", work],
      root,
      cache,
    );
    assert.equal(packed.status, 0, packed.stderr);
    const [{ filename, files }] = JSON.parse(packed.stdout);
    const names = new Set(files.map((file) => file.path));
    assert.ok(names.has("web/vf-ui/artifacts/vkf-symbolic-kernel.wasm"));
    assert.ok(names.has("web/vf-ui/artifacts/vkf-symbolic-kernel.json"));

    const initialized = runNpm(["init", "--yes"], work, cache);
    assert.equal(initialized.status, 0, initialized.stderr);
    const installed = runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-package-lock",
        join(work, filename),
      ],
      work,
      cache,
    );
    assert.equal(installed.status, 0, installed.stderr);

    const packageRoot = join(work, "node_modules", "vektor-flow");
    const wasm = readFileSync(
      join(packageRoot, "web", "vf-ui", "artifacts", "vkf-symbolic-kernel.wasm"),
    );
    const manifest = JSON.parse(readFileSync(
      join(packageRoot, "web", "vf-ui", "artifacts", "vkf-symbolic-kernel.json"),
      "utf8",
    ));
    const runtime = await import(
      pathToFileURL(
        join(packageRoot, "web", "vf-ui", "vf-symbolic-kernel-runtime.mjs"),
      )
    );
    const { instance } = await WebAssembly.instantiate(wasm);
    const kernel = runtime.createSymbolicKernel({ instance, manifest });
    const compiled = kernel.compile("x^2 + pi");
    assert.deepEqual(compiled.value.diagnostics, []);
    assert.equal(compiled.value.classification, "y-of-x");
    assert.ok(Math.abs(kernel.evaluate(compiled.handle, 3, 0) - 12.141592653589793) < 1e-12);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
