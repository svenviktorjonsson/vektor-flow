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
    const manifestUrl = new URL(
      `data:application/json,${encodeURIComponent(JSON.stringify(manifest))}`,
    );
    const kernel = await runtime.loadSymbolicKernel({
      wasm: instance,
      manifest: manifestUrl,
    });
    const compiled = kernel.compile("x^2 + pi");
    assert.deepEqual(compiled.value.diagnostics, []);
    assert.equal(compiled.value.classification, "y-of-x");
    assert.ok(Math.abs(kernel.evaluate(compiled.handle, 3, 0) - 12.141592653589793) < 1e-12);

    const context = {
      kind: "edge",
      dimension: 2,
      originX: 10,
      originY: 20,
      basisXX: 0,
      basisXY: 2,
      basisYX: -2,
      basisYY: 0,
    };
    const workspace = kernel.createWorkspace().handle;
    const localProgram = kernel.workspaceCompile(workspace, "x^2", context);
    const view = {
      xMin: -2,
      xMax: 2,
      yMin: -2,
      yMax: 4,
      xSteps: 65,
      ySteps: 65,
      fieldXSteps: 17,
      fieldYSteps: 17,
      tMin: -2,
      tMax: 2,
      tSteps: 65,
      t: 0,
      vectorScale: 0.35,
    };
    const style = {
      edgeR: 1,
      edgeG: 1,
      edgeB: 1,
      edgeA: 1,
      faceR: 1,
      faceG: 1,
      faceB: 1,
      faceA: 0.5,
      valueMin: 0,
      valueMax: 1,
      colormapPoints: null,
    };
    const arena = kernel.plot(
      localProgram.value.program,
      localProgram.workspace,
      view,
      style,
      7,
    );
    assert.equal(arena.count, view.xSteps);
    assert.deepEqual(arena.ranges.map((range) => ({ ...range })), [{
      mode: "time-curve",
      first: 0,
      count: view.xSteps,
    }]);
    const vertices = new Float32Array(
      kernel.memory.buffer,
      arena.pointer,
      arena.count * arena.stride / Float32Array.BYTES_PER_ELEMENT,
    );
    const positions = Array.from({ length: arena.count }, (_, index) => [
      vertices[index * 6],
      vertices[index * 6 + 1],
    ]);
    assert.deepEqual(positions[0], [-2, 4]);
    assert.deepEqual(positions.at(-1), [2, 4]);
    assert.ok(positions.every(([x, y]) => Math.abs(y - x * x) < 1e-6));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
