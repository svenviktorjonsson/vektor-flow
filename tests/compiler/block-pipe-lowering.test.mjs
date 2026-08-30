import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const nativeDriver = process.env.VKF_NATIVE_DRIVER;
const workRoot = path.join(repositoryRoot, ".work", `u19-block-pipe-${process.pid}`);

after(() => rm(workRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

function executable(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused compiler directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function run(name, input, args = []) {
  const result = spawnSync(executable(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

function lower(source) {
  const tokens = run("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = run("vkf_parser_token_stream_smoke", tokens);
  return JSON.parse(run("vkf_ast_to_ir_smoke", ast));
}

function binding(module, name) {
  const statement = module.body.find(
    ({ kind, name: candidate }) => kind === "store_binding" && candidate === name,
  );
  assert.ok(statement, `missing store binding ${name}`);
  return statement.value;
}

test("a fixed list pipe falls back from numeric folding to a typed block-bodied call", () => {
  const typedIr = lower([
    "choose(index:int) -> int:",
    "    index < 2? @: 10",
    "    @: index",
    "values: ([1..3] >> choose($))",
  ].join("\n"));

  const values = binding(typedIr, "values");
  assert.equal(values.kind, "pipe_chain");
  assert.equal(values.type, "[int:3]");
  assert.deepEqual(values.segments.map(({ kind, type }) => ({ kind, type })), [
    { kind: "call", type: "int" },
  ]);
});

test("an indented block remains a typed pipe segment", () => {
  const typedIr = lower([
    "values: (1..3) >>",
    "    doubled: $ * 2",
    "    doubled + 1",
  ].join("\n"));

  const values = binding(typedIr, "values");
  assert.equal(values.kind, "pipe_chain");
  assert.equal(values.type, "tuple<int,int,int>");
  assert.deepEqual(values.segments.map(({ kind, type }) => ({ kind, type })), [
    { kind: "block_expr", type: "int" },
  ]);
});

test("the unchanged foldered chess bot advances beyond block-pipe lowering", {
  skip: process.platform !== "win32",
}, async () => {
  assert.ok(nativeDriver, "VKF_NATIVE_DRIVER must name the focused strict native driver");
  await mkdir(workRoot, { recursive: true });
  const source = path.join(
    repositoryRoot,
    "examples",
    "programs",
    "vkf_chess_3d",
    "bot_smoke.vkf",
  );
  const artifact = path.join(workRoot, "bot-smoke.exe");
  const result = spawnSync(nativeDriver, ["-b", source, "-o", artifact], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  const diagnostic = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, "chess unexpectedly passed its next migration gate");
  assert.doesNotMatch(diagnostic, /unsupported pipe segment kind block/u);
  assert.match(
    diagnostic,
    /in function __vkf_module_state__piece_at: Cannot declare existing name found; update it with \.found:value/u,
  );
});
