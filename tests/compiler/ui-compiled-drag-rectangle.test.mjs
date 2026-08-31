import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const sharedDemo = require("../../web/vf-ui/vf-shared-rect-demo.js");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.resolve(
  process.env.VKF_TEST_WORK_ROOT ?? path.join(repositoryRoot, ".work", `s04-${process.pid}`),
);

after(() => rm(workRoot, { recursive: true, force: true }));

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined, `failed to start ${command}: ${result.error}`);
  assert.equal(result.status, 0, result.stderr || `${command} failed`);
  return result.stdout;
}

function lower(sourceText) {
  const tokens = run(compilerTool("vkf_lexer_cursor_smoke"), [sourceText]);
  const ast = run(compilerTool("vkf_parser_token_stream_smoke"), [], { input: tokens });
  return JSON.parse(run(compilerTool("vkf_ast_to_ir_smoke"), [], { input: ast }));
}

async function emitFixture() {
  const sourceText = await readFile(
    path.join(repositoryRoot, "tests", "vkf", "ui_compiled_drag_rectangle.vkf"),
    "utf8",
  );
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "compiled-drag-rectangle.vkf");
  const typedIrPath = path.join(workRoot, "compiled-drag-rectangle.typed-ir.json");
  await Promise.all([
    writeFile(source, sourceText, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(lower(sourceText))}\n`, "utf8"),
  ]);
  const summary = JSON.parse(run(compilerTool("vkf_wasm_artifact_smoke"), [
    "--source",
    source,
    "--typed-ir",
    typedIrPath,
  ]));
  const [bytes, manifest] = await Promise.all([
    readFile(summary.artifact_path),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  return { bytes: new Uint8Array(bytes), manifest };
}

let fixtureArtifactPromise;

function fixtureArtifact() {
  fixtureArtifactPromise ??= emitFixture();
  return fixtureArtifactPromise;
}

test("compiler-emitted rectangle runtime owns pointer-anchor translation", async () => {
  const artifact = await fixtureArtifact();
  assert.match(artifact.manifest.source_sha256, /^[0-9a-f]+$/u);
  assert.match(artifact.manifest.typed_ir_sha256, /^[0-9a-f]+$/u);
  assert.notEqual(artifact.manifest.source_sha256, artifact.manifest.typed_ir_sha256);
  const requiredExports = [
    "vkf_init",
    "vkf_update",
    "vkf_shutdown",
    "vkf_state_ptr",
    "vkf_state_size",
    "vkf_input_ptr",
    "vkf_input_size",
  ];
  assert.deepEqual(
    artifact.manifest.runtime_surface.exports.slice(0, requiredExports.length),
    requiredExports,
  );
  const moduleExports = WebAssembly.Module.exports(new WebAssembly.Module(artifact.bytes))
    .map(({ name }) => name);
  assert.ok(moduleExports.includes("memory"));
  for (const name of artifact.manifest.runtime_surface.exports) {
    assert.ok(moduleExports.includes(name), `manifest export ${name} is absent from emitted WASM`);
  }

  const demo = sharedDemo.createBrowserDemo({ compiledArtifact: artifact });
  demo.drivePointerSample({
    pointerActive: true,
    anchor: [12, 18],
    x: 144,
    y: 167,
    down: true,
  });
  assert.deepEqual(demo.getCompiledState(), { x: 132, y: 149 });
  assert.deepEqual(demo.getPrimaryRect(), { x: 132, y: 149, w: 220, h: 200 });
});

test("rectangle runtime rejects missing or malformed artifacts before instantiation", async () => {
  assert.throws(
    () => sharedDemo.createBrowserDemo(),
    /compiler-emitted artifact/u,
  );
  assert.throws(
    () => sharedDemo.createBrowserDemo({ compiledArtifact: { bytes: Uint8Array.of(0) } }),
    /missing its manifest/u,
  );
  assert.throws(
    () => sharedDemo.createBrowserDemo({
      compiledArtifact: {
        bytes: Uint8Array.of(0),
        manifest: { source_sha256: "", typed_ir_sha256: "" },
      },
    }),
    /source provenance/u,
  );
  const artifact = await fixtureArtifact();
  const malformedLayout = structuredClone(artifact.manifest);
  malformedLayout.runtime_surface.state_fields = [{ name: "wrong", offset: 0, type: "num" }];
  assert.throws(
    () => sharedDemo.createBrowserDemo({
      compiledArtifact: { bytes: Uint8Array.of(0), manifest: malformedLayout },
    }),
    /state layout/u,
  );
});
