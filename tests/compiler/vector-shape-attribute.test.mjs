import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;
const workRoot = path.resolve(
  process.env.VKF_TEST_WORK_ROOT ?? path.join(repositoryRoot, "build", "s01-tests"),
);
const executableSuffix = process.platform === "win32" ? ".exe" : "";

function compilerTool(name) {
  assert.ok(nativeBin, "VKF_NATIVE_COMPILER_BIN must name the focused native build directory");
  return path.join(nativeBin, process.platform === "win32" ? `${name}.exe` : name);
}

function runStage(name, input, args = []) {
  const result = spawnSync(compilerTool(name), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || `${name} failed without diagnostics`);
  return result.stdout;
}

function lower(source) {
  const tokens = runStage("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = runStage("vkf_parser_token_stream_smoke", tokens);
  return JSON.parse(runStage("vkf_ast_to_ir_smoke", ast));
}

function binding(module, name) {
  const statement = module.body.find(
    ({ kind, name: candidate }) => kind === "store_binding" && candidate === name,
  );
  assert.ok(statement, `missing store binding ${name}`);
  return statement.value;
}

function expectedShape(...dimensions) {
  return {
    element_type: "int",
    items: dimensions.map((value) => ({ kind: "const", type: "int", value })),
    kind: "list",
    type: `[int:${dimensions.length}]`,
  };
}

function compile(sourceText, stem) {
  mkdirSync(workRoot, { recursive: true });
  const work = mkdtempSync(path.join(workRoot, `s01-${stem}-`));
  const source = path.join(work, `${stem}.vkf`);
  const artifact = path.join(work, `${stem}${executableSuffix}`);
  writeFileSync(source, sourceText, "utf8");
  const result = spawnSync(
    compilerTool("vkf-strict"),
    ["-b", source, "-o", artifact, "--diagnostics"],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  return { artifact, result, work };
}

test("fixed rectangular vector shape is outermost-to-innermost fixed int data", () => {
  const source = [
    "matrix:[[1,2,3],[4,5,6]]",
    "tensor:[[[1,2],[3,4],[5,6]],[[7,8],[9,10],[11,12]]]",
    "matrix_shape:matrix.shape",
    "tensor_shape:tensor.shape",
  ].join("\n");
  const typedIr = lower(source);

  assert.deepEqual(binding(typedIr, "matrix_shape"), expectedShape(2, 3));
  assert.deepEqual(binding(typedIr, "tensor_shape"), expectedShape(2, 3, 2));
});

test("fixed vector shape executes through the native artifact path", () => {
  const compiled = compile([
    "matrix:[[1,2,3],[4,5,6]]",
    "tensor:[[[1,2],[3,4],[5,6]],[[7,8],[9,10],[11,12]]]",
    ":: matrix.shape",
    ":: tensor.shape",
  ].join("\n"), "native");
  try {
    assert.equal(compiled.result.status, 0, compiled.result.stderr);
    const executed = spawnSync(compiled.artifact, [], {
      cwd: compiled.work,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.deepEqual(executed.stdout.trim().split(/\r?\n/u), ["[2, 3]", "[2, 3, 2]"]);
  } finally {
    rmSync(compiled.work, { recursive: true, force: true });
  }
});

test("dynamic vectors reject shape before artifact emission", () => {
  const compiled = compile(
    "c:.collections\nvalues:c.list(1,2,3)\n:: values.shape",
    "dynamic",
  );
  try {
    assert.notEqual(compiled.result.status, 0, "dynamic vector shape unexpectedly compiled");
    assert.match(compiled.result.stderr, /vector shape requires a fixed rectangular vector/u);
    assert.throws(() => accessSync(compiled.artifact));
  } finally {
    rmSync(compiled.work, { recursive: true, force: true });
  }
});

test("jagged vectors reject shape before artifact emission", () => {
  const compiled = compile("values:[[1,2],[3]]\n:: values.shape", "jagged");
  try {
    assert.notEqual(compiled.result.status, 0, "jagged vector shape unexpectedly compiled");
    assert.match(compiled.result.stderr, /vector shape requires a fixed rectangular vector/u);
    assert.throws(() => accessSync(compiled.artifact));
  } finally {
    rmSync(compiled.work, { recursive: true, force: true });
  }
});
