import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.join(repositoryRoot, ".work", `bytecode-ratchet-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function executable(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused compiler directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(name, args, input) {
  const result = spawnSync(executable(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

test("symbolic artifact lowers typed VKF through the bytecode VM", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "square.vkf");
  const typedIr = path.join(workRoot, "square.typed-ir.json");
  const wasm = path.join(workRoot, "square.wasm");
  const manifestPath = path.join(workRoot, "square.json");
  await writeFile(source, "square(x:num) -> num:\n    x * x\n", "utf8");

  const tokens = run("vkf_lexer_cursor_smoke", ["--file", source, source]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const lowered = run("vkf_ast_to_ir_smoke", [], ast);
  await writeFile(typedIr, lowered, "utf8");
  run("vkf_symbolic_kernel_artifact", [
    "--typed-ir", typedIr,
    "--wasm", wasm,
    "--manifest", manifestPath,
    "--entry", "square",
  ]);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schema, "vektor-flow.symbolic-kernel");
  assert.equal(manifest.functions.square.parameters, 1);
  assert.deepEqual(Array.from((await readFile(wasm)).subarray(0, 4)), [0, 97, 115, 109]);
});

test("bytecode lowering retains no definition-only typed-IR wrapper", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "compiler", "native", "vkf_wasm_bytecode_lowering.hpp"),
    "utf8",
  );

  assert.doesNotMatch(source, /inline Module lower_typed_ir_to_bytecode\(/u);
});
