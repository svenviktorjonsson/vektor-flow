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

function binding(module, name) {
  const statement = module.body.find(
    ({ kind, name: candidate }) => kind === "store_binding" && candidate === name,
  );
  assert.ok(statement, `missing store binding ${name}`);
  return statement.value;
}

function keyVector(value, expected) {
  assert.equal(value.kind, "list");
  assert.equal(value.element_type, "str");
  assert.equal(value.type, `[str:${expected.length}]`);
  assert.deepEqual(value.items, expected.map((key) => ({
    kind: "const",
    type: "str",
    value: key,
  })));
}

test("anonymous record value and type spills return the same ordered key vector", () => {
  const typedIr = lower([
    'record:(z:3,label:"three",enabled:true)',
    'value_keys:[:record]',
    'type_keys:[:record.]',
  ].join("\n"));

  const valueKeys = binding(typedIr, "value_keys");
  const typeKeys = binding(typedIr, "type_keys");
  keyVector(valueKeys, ["z", "label", "enabled"]);
  assert.deepEqual(valueKeys, typeKeys);
});

test("named and nominal heterogeneous records preserve declaration order", () => {
  const typedIr = lower([
    'NamedRecord:(first:int,second:str)',
    'NamedRecord named:(first:1,second:"two")',
    'named_keys:[:named]',
    'named_type_keys:[:named.]',
    'OrderedPoint(x:num,label:str,enabled:bit):(x:x,label:label,enabled:enabled)',
    'point:OrderedPoint(4,"four",true)',
    'point_keys:[:point]',
    'point_type_keys:[:point.]',
    'constructor_keys:[:OrderedPoint]',
    'field_types:(:point.)',
    'multiset_keys:{:point}',
    'multiset_type_keys:{:point.}',
  ].join("\n"));

  const namedKeys = binding(typedIr, "named_keys");
  keyVector(namedKeys, ["first", "second"]);
  assert.deepEqual(namedKeys, binding(typedIr, "named_type_keys"));

  const pointKeys = binding(typedIr, "point_keys");
  keyVector(pointKeys, ["x", "label", "enabled"]);
  assert.deepEqual(pointKeys, binding(typedIr, "point_type_keys"));
  assert.deepEqual(pointKeys, binding(typedIr, "constructor_keys"));

  assert.deepEqual(binding(typedIr, "field_types"), {
    kind: "const",
    type: "type<record{x:num,label:str,enabled:bit}>",
    value: "(x:num, label:str, enabled:bit)",
  });
  assert.deepEqual(
    binding(typedIr, "multiset_keys"),
    binding(typedIr, "multiset_type_keys"),
  );
});

test("empty nominal record value and type spills return an empty fixed string vector", () => {
  const typedIr = lower([
    "EmptyRecord(): :",
    "empty:EmptyRecord()",
    "value_keys:[:empty]",
    "type_keys:[:empty.]",
    "constructor_keys:[:EmptyRecord]",
  ].join("\n"));

  const valueKeys = binding(typedIr, "value_keys");
  keyVector(valueKeys, []);
  assert.deepEqual(valueKeys, binding(typedIr, "type_keys"));
  assert.deepEqual(valueKeys, binding(typedIr, "constructor_keys"));
});
