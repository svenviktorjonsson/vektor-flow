import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const nativeBin = process.env.VKF_NATIVE_COMPILER_BIN;

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

function lowerFailure(source) {
  const tokens = runStage("vkf_lexer_cursor_smoke", undefined, [source]);
  const ast = runStage("vkf_parser_token_stream_smoke", tokens);
  return spawnSync(compilerTool("vkf_ast_to_ir_smoke"), [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: ast,
    windowsHide: true,
  });
}

function lowerAstFailure(ast) {
  return spawnSync(compilerTool("vkf_ast_to_ir_smoke"), [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: JSON.stringify(ast),
    windowsHide: true,
  });
}

function binding(module, name) {
  const statement = module.body.find(
    ({ kind, name: candidate }) => kind === "store_binding" && candidate === name,
  );
  assert.ok(statement, `missing store binding ${name}`);
  return statement.value;
}

function multisetKeys(value) {
  assert.equal(value.kind, "multiset");
  assert.equal(value.type, "multiset<str>");
  return value.pairs
    .map(({ key, count }) => {
      assert.deepEqual(count, { kind: "const", type: "num", value: 1 });
      assert.equal(key.kind, "const");
      assert.equal(key.type, "str");
      return key.value;
    })
    .sort();
}

test("record value and type spills discard values and produce the same key multiset", () => {
  const typedIr = lower([
    'first:(x:1,label:"first")',
    'second:(x:999,label:"second")',
    'first_keys:{:first}',
    'first_type_keys:{:first.}',
    'second_keys:{:second}',
  ].join("\n"));

  const firstKeys = binding(typedIr, "first_keys");
  const firstTypeKeys = binding(typedIr, "first_type_keys");
  const secondKeys = binding(typedIr, "second_keys");
  assert.deepEqual(multisetKeys(firstKeys), ["label", "x"]);
  assert.deepEqual(firstKeys, firstTypeKeys);
  assert.deepEqual(firstKeys, secondKeys);
  assert.doesNotMatch(JSON.stringify(firstKeys), /first|second|999/);
});

test("nominal heterogeneous record spill uses accessible representation keys only", () => {
  const typedIr = lower([
    'RecordKeySample(x:num,label:str):(x:x,label:label)',
    'sample:RecordKeySample(7,"seven")',
    'keys:{:sample}',
    'type_keys:{:sample.}',
  ].join("\n"));

  const keys = binding(typedIr, "keys");
  assert.deepEqual(multisetKeys(keys), ["label", "x"]);
  assert.deepEqual(keys, binding(typedIr, "type_keys"));
  assert.doesNotMatch(JSON.stringify(keys), /seven|7|RecordKeySample/);
});

test("record spill does not reevaluate the already-bound subject", () => {
  const typedIr = lower([
    'RecordKeyMade(x:num):(value:x,flag:1)',
    'made:RecordKeyMade(4)',
    'keys:{:made}',
  ].join("\n"));

  const made = binding(typedIr, "made");
  const keys = binding(typedIr, "keys");
  assert.equal(made.kind, "call");
  assert.deepEqual(multisetKeys(keys), ["flag", "value"]);
  assert.doesNotMatch(JSON.stringify(keys), /call|load|dotted_index/);
});

test("tuple and vector multiset spills remain value spills", () => {
  const typedIr = lower([
    'tuple_values:(1,2,2)',
    'tuple_spill:{:tuple_values}',
    'vector_values:[1,2,2]',
    'vector_spill:{:vector_values}',
  ].join("\n"));

  assert.deepEqual(binding(typedIr, "tuple_spill"), {
    element_type: "int",
    kind: "multiset_from_collection",
    type: "multiset<int>",
    value: { kind: "load", name: "tuple_values", type: "tuple<int,int,int>" },
  });
  assert.deepEqual(binding(typedIr, "vector_spill"), {
    element_type: "int",
    kind: "multiset_from_collection",
    type: "multiset<int>",
    value: { kind: "load", name: "vector_values", type: "[int:3]" },
  });
});

test("non-record scalar value spill remains rejected", () => {
  const result = lowerFailure([
    "scalar:1",
    "invalid:{:scalar}",
  ].join("\n"));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /container value spill requires a vector, tuple, list, or multiset/);
});

test("malformed record spill IR remains rejected", () => {
  const result = lowerAstFailure({
    kind: "module",
    body: [{ kind: "container_spill", container: "multiset" }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing field value in container spill/);
});
