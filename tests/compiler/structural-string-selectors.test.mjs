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
  const result = spawnSync(compilerTool("vkf_ast_to_ir_smoke"), [], {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: ast,
    windowsHide: true,
  });
  assert.notEqual(result.status, 0, "lowering unexpectedly succeeded");
  return `${result.stdout}\n${result.stderr}`;
}

function binding(module, name) {
  const statement = module.body.find(
    ({ kind, name: candidate }) => kind === "store_binding" && candidate === name,
  );
  assert.ok(statement, `missing store binding ${name}`);
  return statement.value;
}

test("fixed string selectors return homogeneous fields as a vector in selector order", () => {
  const typedIr = lower([
    "point:(x:3,y:4)",
    'selected:point.(["y","x"])',
  ].join("\n"));

  assert.deepEqual(binding(typedIr, "selected"), {
    element_type: "int",
    items: [
      {
        field: "y",
        kind: "field_access",
        object: { kind: "load", name: "point", type: "record{x:int,y:int}" },
        object_type: "record{x:int,y:int}",
        type: "int",
      },
      {
        field: "x",
        kind: "field_access",
        object: { kind: "load", name: "point", type: "record{x:int,y:int}" },
        object_type: "record{x:int,y:int}",
        type: "int",
      },
    ],
    kind: "list",
    type: "[int:2]",
  });
});

test("scalar string selectors return a scalar field and preserve dot-overload fallback", () => {
  const typedIr = lower([
    "ReachPair(x:num,y:num):(x:x,y:y)",
    ".(pair:ReachPair,key:str) -> num:",
    '  key="left"? @:pair.x',
    "  @:0",
    "pair:ReachPair(3,4)",
    'real:pair.("x")',
    'virtual:pair.("left")',
    'ordered:pair.(["y","x"])',
  ].join("\n"));

  assert.equal(binding(typedIr, "real").kind, "field_access");
  assert.equal(binding(typedIr, "real").type, "num");
  assert.equal(binding(typedIr, "virtual").kind, "call");
  assert.equal(binding(typedIr, "virtual").type, "num");
  assert.equal(binding(typedIr, "ordered").type, "[num:2]");
});

test("fixed string selectors return heterogeneous fields as a tuple", () => {
  const typedIr = lower([
    'row:(label:"vkf",count:3)',
    'selected:row.(["count","label"])',
  ].join("\n"));

  assert.deepEqual(binding(typedIr, "selected"), {
    items: [
      {
        field: "count",
        kind: "field_access",
        object: { kind: "load", name: "row", type: "record{label:str,count:int}" },
        object_type: "record{label:str,count:int}",
        type: "int",
      },
      {
        field: "label",
        kind: "field_access",
        object: { kind: "load", name: "row", type: "record{label:str,count:int}" },
        object_type: "record{label:str,count:int}",
        type: "str",
      },
    ],
    kind: "tuple",
    type: "tuple<int,str>",
  });
});

test("ordered reflected keys select all unnamed record values", () => {
  const typedIr = lower([
    'row:(label:"vkf",count:3)',
    "selected:row.([:row])",
  ].join("\n"));

  assert.equal(binding(typedIr, "selected").type, "tuple<str,int>");
  assert.deepEqual(
    binding(typedIr, "selected").items.map(({ field }) => field),
    ["label", "count"],
  );
});

test("unknown fixed selectors reject records including empty records", () => {
  assert.match(
    lowerFailure([
      "Empty(): :",
      "empty:Empty()",
      'invalid:empty.(["missing"])',
    ].join("\n")),
    /unknown record selector key missing/,
  );
});

test("fixed selectors evaluate a call subject exactly once", () => {
  const typedIr = lower([
    "Point(x:num,y:num):(x:x,y:y)",
    "make() -> Point:",
    "  @:Point(3,4)",
    'selected:make().(["y","x"])',
  ].join("\n"));
  const selected = binding(typedIr, "selected");

  assert.equal(selected.kind, "block_expr");
  assert.equal((JSON.stringify(selected).match(/\"kind\":\"call\"/g) ?? []).length, 1);
});

test("dynamic string selectors require one statically guaranteed field type", () => {
  const typedIr = lower([
    "Point:(x:num,y:num)",
    "select(point:Point,name:str) -> num:",
    "  @:point.(name)",
  ].join("\n"));
  const select = typedIr.body.find(({ kind, name }) => kind === "function" && name === "select");
  assert.ok(select);
  assert.match(JSON.stringify(select), /record_selector/);

  assert.match(
    lowerFailure([
      "Row:(label:str,count:num)",
      "select(row:Row,name:str):",
      "  @:row.(name)",
    ].join("\n")),
    /dynamic record selector requires one compatible result type/,
  );
});

test("dynamic string selectors support anonymous homogeneous records", () => {
  const typedIr = lower([
    "point:(x:1,y:2)",
    'name:"y"',
    "selected:point.(name)",
  ].join("\n"));

  assert.equal(binding(typedIr, "selected").kind, "record_selector");
  assert.equal(binding(typedIr, "selected").type, "int");
});

test("normal numeric promotion gives int and num selectors one num result type", () => {
  const typedIr = lower([
    "row:(whole:1,fraction:2.5)",
    'fixed:row.(["whole","fraction"])',
    'name:"whole"',
    "dynamic:row.(name)",
  ].join("\n"));

  assert.equal(binding(typedIr, "fixed").type, "[num:2]");
  assert.deepEqual(
    binding(typedIr, "fixed").items.map(({ type }) => type),
    ["num", "num"],
  );
  assert.equal(binding(typedIr, "dynamic").kind, "record_selector");
  assert.equal(binding(typedIr, "dynamic").type, "num");
});

test("repeated fixed selector keys preserve every lane in exact order", () => {
  const typedIr = lower([
    'row:(x:1,label:"vkf")',
    'homogeneous:row.(["x","x"])',
    'heterogeneous:row.(["label","x","label"])',
  ].join("\n"));

  assert.equal(binding(typedIr, "homogeneous").type, "[int:2]");
  assert.deepEqual(
    binding(typedIr, "homogeneous").items.map(({ field }) => field),
    ["x", "x"],
  );
  assert.equal(binding(typedIr, "heterogeneous").type, "tuple<str,int,str>");
  assert.deepEqual(
    binding(typedIr, "heterogeneous").items.map(({ field }) => field),
    ["label", "x", "label"],
  );
});

test("dynamic missing keys use dot overload without intercepting real fields", () => {
  const typedIr = lower([
    "Fallback:(x:num)",
    ".(value:Fallback,key:str) -> num:",
    '  key="virtual"? @:42',
    "  @:99",
    "select(value:Fallback,key:str) -> num:",
    "  @:value.(key)",
  ].join("\n"));
  const select = typedIr.body.find(({ kind, name }) => kind === "function" && name === "select");
  const selector = JSON.parse(JSON.stringify(select)).body.body[0].value;

  assert.equal(selector.kind, "record_selector");
  assert.match(selector.fallback_symbol, /\.$/);
  assert.equal(selector.type, "num");
});

test("dynamic selector requires a common result with its missing-key overload", () => {
  const promoted = lower([
    "Fallback:(x:int)",
    ".(value:Fallback,key:str) -> num:",
    "  @:2.5",
    "select(value:Fallback,key:str) -> num:",
    "  @:value.(key)",
  ].join("\n"));
  const select = promoted.body.find(({ kind, name }) => kind === "function" && name === "select");
  assert.match(JSON.stringify(select), /\"type\":\"num\"/);

  assert.match(
    lowerFailure([
      "Fallback:(x:num)",
      ".(value:Fallback,key:str) -> str:",
      '  @:"missing"',
      "select(value:Fallback,key:str):",
      "  @:value.(key)",
    ].join("\n")),
    /dynamic record selector and dot overload require one compatible result type/,
  );
});

test("fixed selector lanes use dot overload only for missing keys", () => {
  const typedIr = lower([
    "Fallback(x:num,y:num):(x:x,y:y)",
    ".(value:Fallback,key:str) -> num:",
    '  key="virtual"? @:42',
    "  @:99",
    "value:Fallback(7,8)",
    'selected:value.(["x","virtual","x"])',
  ].join("\n"));
  const selected = binding(typedIr, "selected");

  assert.equal(selected.type, "[num:3]");
  assert.deepEqual(selected.items.map(({ kind }) => kind), ["field_access", "call", "field_access"]);
});

test("dynamic names on an empty record use its dot overload", () => {
  const typedIr = lower([
    "Empty(): :",
    ".(value:Empty,key:str) -> num:",
    "  @:73",
    "select(value:Empty,key:str) -> num:",
    "  @:value.(key)",
  ].join("\n"));
  const select = typedIr.body.find(({ kind, name }) => kind === "function" && name === "select");
  const selector = JSON.parse(JSON.stringify(select)).body.body[0].value;

  assert.equal(selector.kind, "record_selector");
  assert.deepEqual(selector.fields, []);
  assert.equal(selector.type, "num");
  assert.equal(typeof selector.fallback_symbol, "string");
});

test("real and fallback string selections share owned result behavior", () => {
  const typedIr = lower([
    "Text(first:str,second:str):(first:first,second:second)",
    ".(value:Text,key:str) -> str:",
    '  @:"fallback"',
    "select(value:Text,key:str) -> str:",
    "  @:value.(key)",
    'value:Text("real","other")',
    'fixed:value.(["first","virtual"])',
  ].join("\n"));
  const select = typedIr.body.find(({ kind, name }) => kind === "function" && name === "select");
  const selector = JSON.parse(JSON.stringify(select)).body.body[0].value;

  assert.equal(selector.kind, "record_selector");
  assert.equal(selector.type, "str");
  assert.equal(binding(typedIr, "fixed").type, "[str:2]");
  assert.deepEqual(binding(typedIr, "fixed").items.map(({ kind }) => kind), ["field_access", "call"]);
});
