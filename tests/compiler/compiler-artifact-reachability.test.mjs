import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.join(repositoryRoot, ".work", `artifact-reachability-${process.pid}`);

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

test("compiler artifact evaluates lowered VKF arithmetic", async () => {
  await mkdir(workRoot, { recursive: true });
  const source = path.join(workRoot, "answer.vkf");
  const typedIr = path.join(workRoot, "answer.typed-ir.json");
  await writeFile(source, "answer: 41 + 1\n:: answer\n", "utf8");

  const tokens = run("vkf_lexer_cursor_smoke", ["--file", source]);
  const ast = run("vkf_parser_token_stream_smoke", [], tokens);
  const lowered = run("vkf_ast_to_ir_smoke", [], ast);
  await writeFile(typedIr, lowered, "utf8");

  const output = run(
    "vkf_compiler_artifact_smoke",
    ["--source", source, "--typed-ir", typedIr, "--run-typed-ir"],
  );
  assert.equal(output.trim(), "42");
});

test("compiler artifact retains no definition-only UI placeholder predicate", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "compiler", "native", "vkf_compiler_artifact_smoke.cpp"),
    "utf8",
  );

  assert.doesNotMatch(source, /bool is_ui_placeholder\(/u);
});
