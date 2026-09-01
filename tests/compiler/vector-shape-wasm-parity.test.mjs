import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  process.env.VKF_TEST_WORK_ROOT ?? path.join(repositoryRoot, ".work", `s02-${process.pid}`),
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

async function writeProgram(stem, sourceText) {
  const directory = path.join(workRoot, stem);
  await mkdir(directory, { recursive: true });
  const source = path.join(directory, `${stem}.vkf`);
  const typedIrPath = path.join(directory, `${stem}.typed-ir.json`);
  await Promise.all([
    writeFile(source, `${sourceText}\n`, "utf8"),
    writeFile(typedIrPath, `${JSON.stringify(lower(sourceText))}\n`, "utf8"),
  ]);
  return { directory, source, typedIrPath };
}

function formatVector(values) {
  return `[${values.join(", ")}]`;
}

test("fixed vector shape produces the same values through native and WASM execution", async () => {
  const sourceText = [
    "matrix_shape:[[1,2,3],[4,5,6]].shape",
    "tensor_shape:[[[1,2],[3,4],[5,6]],[[7,8],[9,10],[11,12]]].shape",
    ":: matrix_shape",
    ":: tensor_shape",
  ].join("\n");
  const program = await writeProgram("shape", sourceText);
  const nativeArtifact = path.join(program.directory, `shape-native${executableSuffix}`);
  run(compilerTool("vkf-strict"), ["-b", program.source, "-o", nativeArtifact]);
  const nativeOutput = run(nativeArtifact, []).trim().split(/\r?\n/u);

  const summary = JSON.parse(run(compilerTool("vkf_wasm_artifact_smoke"), [
    "--source",
    program.source,
    "--typed-ir",
    program.typedIrPath,
  ]));
  const [bytes, manifest] = await Promise.all([
    readFile(summary.artifact_path),
    readFile(summary.manifest_path, "utf8").then(JSON.parse),
  ]);
  const runtime = runtimeBridge.instantiateWasmRuntime({ bytes, manifest });
  const wasmOutput = ["matrix_shape", "tensor_shape"].map((name) =>
    formatVector(runtime.readBinding(name).values));

  assert.deepEqual(nativeOutput, ["[2, 3]", "[2, 3, 2]"]);
  assert.deepEqual(wasmOutput, nativeOutput);
});

test("ordinary nested vector storage remains outside the narrow WASM boundary", async () => {
  const program = await writeProgram("nested", "matrix:[[1,2],[3,4]]");
  const result = spawnSync(
    compilerTool("vkf_wasm_artifact_smoke"),
    ["--source", program.source, "--typed-ir", program.typedIrPath],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  assert.equal(result.error, undefined, `WASM emitter did not start: ${result.error}`);
  assert.notEqual(result.status, 0, "nested ordinary vector unexpectedly emitted WASM");
  assert.match(result.stderr, /wasm computed binding list only supports scalar items/u);
  await assert.rejects(access(path.join(program.directory, ".vkfbuild")));
});
