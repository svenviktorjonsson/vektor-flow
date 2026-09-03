import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createSymbolicKernel } from "../../web/vf-ui/vf-symbolic-kernel-runtime.mjs";

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

test("bytecode VM lowers assertions used by the self-hosted compiler", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "checked.vkf");
  const typedIr = path.join(workRoot, "checked.typed-ir.json");
  const wasm = path.join(workRoot, "checked.wasm");
  const manifestPath = path.join(workRoot, "checked.json");
  await writeFile(source, [
    "checked(x:num) -> num:",
    '    (x > 0)?! "positive value required"',
    "    x",
    "",
  ].join("\n"), "utf8");

  const tokens = run("vkf_lexer_cursor_smoke", ["--file", source, source]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const lowered = run("vkf_ast_to_ir_smoke", [], ast);
  await writeFile(typedIr, lowered, "utf8");
  run("vkf_symbolic_kernel_artifact", [
    "--typed-ir", typedIr,
    "--wasm", wasm,
    "--manifest", manifestPath,
    "--entry", "checked",
  ]);

  const [{ instance }, manifest] = await Promise.all([
    WebAssembly.instantiate(await readFile(wasm)),
    readFile(manifestPath, "utf8").then(JSON.parse),
  ]);
  const kernel = createSymbolicKernel({ instance, manifest });
  assert.equal(kernel.invokeValue("checked", [7]), 7);
  assert.throws(
    () => kernel.invokeValue("checked", [-1]),
    /unreachable/u,
  );
});

test("bytecode VM orders UTF-8 strings for compiler character classes", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "string-order.vkf");
  const typedIr = path.join(workRoot, "string-order.typed-ir.json");
  const wasm = path.join(workRoot, "string-order.wasm");
  const manifestPath = path.join(workRoot, "string-order.json");
  await writeFile(source, [
    "is_lower(ch:str) -> bit:",
    '    ch >= "a" /\\ ch <= "z"',
    "",
  ].join("\n"), "utf8");

  const tokens = run("vkf_lexer_cursor_smoke", ["--file", source, source]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const lowered = run("vkf_ast_to_ir_smoke", [], ast);
  await writeFile(typedIr, lowered, "utf8");
  run("vkf_symbolic_kernel_artifact", [
    "--typed-ir", typedIr,
    "--wasm", wasm,
    "--manifest", manifestPath,
    "--entry", "is_lower",
  ]);

  const [{ instance }, manifest] = await Promise.all([
    WebAssembly.instantiate(await readFile(wasm)),
    readFile(manifestPath, "utf8").then(JSON.parse),
  ]);
  const kernel = createSymbolicKernel({ instance, manifest });
  assert.equal(kernel.invokeValue("is_lower", ["b"]), true);
  assert.equal(kernel.invokeValue("is_lower", ["A"]), false);
  assert.equal(kernel.invokeValue("is_lower", ["å"]), false);
});

test("bytecode VM returns one UTF-8 scalar as compiler text", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "peek-scalar.vkf");
  const typedIr = path.join(workRoot, "peek-scalar.typed-ir.json");
  const wasm = path.join(workRoot, "peek-scalar.wasm");
  const manifestPath = path.join(workRoot, "peek-scalar.json");
  await writeFile(source, [
    "first(source:str) -> str:",
    "    vkf_string_peek_scalar(source, 0)",
    "",
  ].join("\n"), "utf8");

  const tokens = run("vkf_lexer_cursor_smoke", ["--file", source, source]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const lowered = run("vkf_ast_to_ir_smoke", [], ast);
  await writeFile(typedIr, lowered, "utf8");
  run("vkf_symbolic_kernel_artifact", [
    "--typed-ir", typedIr,
    "--wasm", wasm,
    "--manifest", manifestPath,
    "--entry", "first",
  ]);

  const [{ instance }, manifest] = await Promise.all([
    WebAssembly.instantiate(await readFile(wasm)),
    readFile(manifestPath, "utf8").then(JSON.parse),
  ]);
  const kernel = createSymbolicKernel({ instance, manifest });
  assert.equal(kernel.invokeValue("first", ["åland"]), "å");
});

test("bytecode lowering retains no definition-only typed-IR wrapper", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "compiler", "native", "vkf_wasm_bytecode_lowering.hpp"),
    "utf8",
  );

  assert.doesNotMatch(source, /inline Module lower_typed_ir_to_bytecode\(/u);
});
