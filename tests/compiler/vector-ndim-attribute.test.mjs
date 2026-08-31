import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const require = createRequire(import.meta.url);
const runtimeBridge = require("../../web/vf-ui/vf-compiled-runtime-bridge.js");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.resolve(
  process.env.VKF_TEST_WORK_ROOT ?? path.join(repositoryRoot, ".work", `s03-${process.pid}`),
);
const executableSuffix = process.platform === "win32" ? ".exe" : "";

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

function lowerFailure(sourceText) {
  const tokens = run(compilerTool("vkf_lexer_cursor_smoke"), [sourceText]);
  const ast = run(compilerTool("vkf_parser_token_stream_smoke"), [], { input: tokens });
  return spawnSync(compilerTool("vkf_ast_to_ir_smoke"), [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: ast,
    timeout: 30_000,
    windowsHide: true,
  });
}

function binding(module, name) {
  const statement = module.body.find(
    ({ kind, name: candidate }) => kind === "store_binding" && candidate === name,
  );
  assert.ok(statement, `missing store binding ${name}`);
  return statement;
}

async function assertUnsupported(sourceText, stem) {
  const lowered = lowerFailure(sourceText);
  assert.equal(lowered.error, undefined, `AST lowerer did not start: ${lowered.error}`);
  assert.notEqual(lowered.status, 0, `${stem} vector ndim unexpectedly lowered`);
  assert.match(lowered.stderr, /vector ndim requires a fixed rectangular vector/u);

  const directory = path.join(workRoot, stem);
  await mkdir(directory, { recursive: true });
  const source = path.join(directory, `${stem}.vkf`);
  const artifact = path.join(directory, `${stem}${executableSuffix}`);
  await writeFile(source, `${sourceText}\n`, "utf8");
  const compiled = spawnSync(
    compilerTool("vkf-strict"),
    ["-b", source, "-o", artifact],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  assert.equal(compiled.error, undefined, `strict compiler did not start: ${compiled.error}`);
  assert.notEqual(compiled.status, 0, `${stem} vector ndim unexpectedly compiled`);
  assert.match(compiled.stderr, /vector ndim requires a fixed rectangular vector/u);
  await assert.rejects(access(artifact));
  await assert.rejects(access(path.join(directory, ".vkfbuild")));
}

test("fixed vector ndim is the same scalar int through native and WASM", async () => {
  const sourceText = [
    "matrix_ndim:[[1,2,3],[4,5,6]].ndim",
    "tensor_ndim:[[[1,2],[3,4],[5,6]],[[7,8],[9,10],[11,12]]].ndim",
    ":: matrix_ndim",
    ":: tensor_ndim",
  ].join("\n");
  const typedIr = lower(sourceText);
  assert.deepEqual(binding(typedIr, "matrix_ndim"), {
    kind: "store_binding",
    name: "matrix_ndim",
    type: "int",
    update: false,
    value: { kind: "const", type: "int", value: 2 },
  });
  assert.deepEqual(binding(typedIr, "tensor_ndim"), {
    kind: "store_binding",
    name: "tensor_ndim",
    type: "int",
    update: false,
    value: { kind: "const", type: "int", value: 3 },
  });

  const directory = path.join(workRoot, "ndim");
  await mkdir(directory, { recursive: true });
  const source = path.join(directory, "ndim.vkf");
  const typedIrPath = path.join(directory, "ndim.typed-ir.json");
  const nativeArtifact = path.join(directory, `ndim-native${executableSuffix}`);
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(typedIr)}\n`, "utf8"),
  ]);

  run(compilerTool("vkf-strict"), ["-b", source, "-o", nativeArtifact]);
  const nativeOutput = run(nativeArtifact, []).trim().split(/\r?\n/u);
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
  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes, manifest });

  assert.deepEqual(nativeOutput, ["2", "3"]);
  assert.deepEqual(
    [runtime.readBinding("matrix_ndim"), runtime.readBinding("tensor_ndim")],
    [2, 3],
  );
});

test("dynamic vector ndim rejects before native or WASM artifact emission", async () => {
  await assertUnsupported(
    "c:.collections\nvalues:c.list(1,2,3)\n:: values.ndim",
    "dynamic",
  );
});

test("jagged vector ndim rejects before native or WASM artifact emission", async () => {
  await assertUnsupported("values:[[1,2],[3]]\n:: values.ndim", "jagged");
});
