import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", "Release");
const x64Artifact = join(nativeBin, `vkf_x64_artifact${executableSuffix}`);

const constValue = (value, type) => ({ kind: "const", type, value });
const field = (name, value, type) => ({ kind: "field", name, type, value });
const record = (type, fields) => ({ fields, kind: "record", type });
const list = (type, items, elementType = "any") => ({
  element_type: elementType,
  items,
  kind: "list",
  type,
});
const load = (name, type) => ({ kind: "load", name, type });
const access = (object, objectType, name, type) => ({
  field: name,
  kind: "field_access",
  object,
  object_type: objectType,
  type,
});
const at = (base, index, type) => ({
  base,
  expanded_index_count: 1,
  indices: [constValue(index, "int")],
  kind: "dotted_index",
  type,
});
const equal = (left, right, rightType) => ({
  kind: "binary_op",
  left,
  left_type: left.type,
  op: "EQ",
  right: constValue(right, rightType),
  right_type: rightType,
  type: "bit",
});
const andAll = (conditions) => conditions.slice(1).reduce((left, right) => ({
  kind: "binary_op",
  left,
  left_type: "bit",
  op: "AND",
  right,
  right_type: "bit",
  type: "bit",
}), conditions[0]);

const expressionType = "record{kind:str,left:record{kind:str,name:str,type:str},left_type:str,op:str,right:record{kind:str,type:str,value:num},right_type:str,type:str}";
const statementType = `record{expr:${expressionType},kind:str}`;
const blockType = `record{body:[${statementType}:1],kind:str}`;
const parameterType = "record{default:null,kind:str,name:str,type:str,variadic_named:bit,variadic_positional:bit}";
const signatureType = "record{kind:str,params:[str:1],return_type:str,type:str}";
const functionType = `record{body:${blockType},kind:str,name:str,params:[${parameterType}:1],representation_type:str,return_type:str,signature:${signatureType},type:str}`;
const markerType = "record{kind:str,value:int}";
const typedModuleType = "record{body:[any:2],kind:str}";

function typedFunctionEnvelope() {
  const expression = record(expressionType, [
    field("kind", constValue("binary_op", "str"), "str"),
    field("left", record("record{kind:str,name:str,type:str}", [
      field("kind", constValue("load", "str"), "str"),
      field("name", constValue("value", "str"), "str"),
      field("type", constValue("num", "str"), "str"),
    ]), "record{kind:str,name:str,type:str}"),
    field("left_type", constValue("num", "str"), "str"),
    field("op", constValue("STAR", "str"), "str"),
    field("right", record("record{kind:str,type:str,value:num}", [
      field("kind", constValue("const", "str"), "str"),
      field("type", constValue("int", "str"), "str"),
      field("value", constValue(2, "num"), "num"),
    ]), "record{kind:str,type:str,value:num}"),
    field("right_type", constValue("int", "str"), "str"),
    field("type", constValue("num", "str"), "str"),
  ]);
  const statement = record(statementType, [
    field("expr", expression, expressionType),
    field("kind", constValue("expr_stmt", "str"), "str"),
  ]);
  return record(functionType, [
    field("body", record(blockType, [
      field("body", list(`[${statementType}:1]`, [statement], statementType), `[${statementType}:1]`),
      field("kind", constValue("block", "str"), "str"),
    ]), blockType),
    field("kind", constValue("function", "str"), "str"),
    field("name", constValue("twice", "str"), "str"),
    field("params", list(`[${parameterType}:1]`, [record(parameterType, [
      field("default", constValue(null, "null"), "null"),
      field("kind", constValue("param", "str"), "str"),
      field("name", constValue("value", "str"), "str"),
      field("type", constValue("num", "str"), "str"),
      field("variadic_named", constValue(false, "bit"), "bit"),
      field("variadic_positional", constValue(false, "bit"), "bit"),
    ])], parameterType), `[${parameterType}:1]`),
    field("representation_type", constValue("num", "str"), "str"),
    field("return_type", constValue("num", "str"), "str"),
    field("signature", record(signatureType, [
      field("kind", constValue("function_signature", "str"), "str"),
      field("params", list("[str:1]", [constValue("num", "str")], "str"), "[str:1]"),
      field("return_type", constValue("num", "str"), "str"),
      field("type", constValue("fn(num)->num", "str"), "str"),
    ]), signatureType),
    field("type", constValue("fn(num)->num", "str"), "str"),
  ]);
}

function call(name, type, args, argTypes, resultType) {
  return {
    arg_types: argTypes,
    args,
    callee: load(name, type),
    callee_type: type,
    kind: "call",
    named_args: [],
    spread_args: [],
    type: resultType,
  };
}

function moduleIr(malformed = false) {
  const producerName = "__vkf_module_stage__produce";
  const matcherName = "__vkf_module_stage__matches";
  const application = load("application", "any");
  const body = access(application, typedModuleType, "body", "[any:2]");
  const functionValue = at(body, 0, functionType);
  const functionBody = access(functionValue, functionType, "body", blockType);
  const statements = access(functionBody, blockType, "body", `[${statementType}:1]`);
  const statement = at(statements, 0, statementType);
  const expression = access(statement, statementType, "expr", expressionType);
  const marker = at(body, 1, markerType);
  const rightType = "record{kind:str,type:str,value:num}";
  const conditions = [
    equal(access(application, typedModuleType, "kind", "str"), "typed_module", "str"),
    equal(access(functionValue, functionType, "kind", "str"), "function", "str"),
    equal(access(access(expression, expressionType, "right", rightType), rightType, "value", "num"), 2, "int"),
    equal(access(marker, markerType, "kind", "str"), "marker", "str"),
    equal(access(marker, markerType, "value", "int"), 7, "int"),
  ];
  const typedModule = record(typedModuleType, [
    field("body", list("[any:2]", [
      typedFunctionEnvelope(),
      record(markerType, [
        field("kind", constValue("marker", "str"), "str"),
        field("value", constValue(7, "int"), "int"),
      ]),
    ]), "[any:2]"),
    field("kind", constValue("typed_module", "str"), "str"),
  ]);
  const producer = {
    body: { body: [{ expr: typedModule, kind: "expr_stmt" }], kind: "block" },
    kind: "function",
    name: producerName,
    params: [],
    representation_type: "any",
    return_type: "any",
    signature: { kind: "function_signature", params: [], return_type: "any", type: "fn()->any" },
    type: "fn()->any",
  };
  const matcher = {
    body: { body: [{ expr: andAll(conditions), kind: "expr_stmt" }], kind: "block" },
    kind: "function",
    name: matcherName,
    params: [{
      default: null,
      kind: "param",
      name: "application",
      type: "any",
      variadic_named: false,
      variadic_positional: false,
    }],
    representation_type: "bit",
    return_type: "bit",
    signature: { kind: "function_signature", params: ["any"], return_type: "bit", type: "fn(any)->bit" },
    type: "fn(any)->bit",
  };
  const producerCall = call(producerName, "fn()->any", [], [], "any");
  const matcherArgument = malformed ? constValue(9, "int") : load("wrapped", "any");
  const matcherCall = call(matcherName, "fn(any)->bit", [matcherArgument], [matcherArgument.type], "bit");
  const printCall = {
    arg_types: ["bit"],
    args: [matcherCall],
    callee: {
      full_name: "io.print",
      kind: "stdlib_function",
      module: "io",
      name: "print",
      type: "fn(any)->any",
    },
    callee_type: "fn(any)->any",
    kind: "call",
    named_args: [],
    spread_args: [],
    type: "any",
  };
  return {
    body: [
      {
        alias: "stage",
        kind: "module_import",
        path: { kind: "dot_module_path", segments: ["stage"] },
      },
      producer,
      matcher,
      { kind: "store_binding", name: "wrapped", type: "any", update: false, value: producerCall },
      { expr: printCall, kind: "expr_stmt" },
    ],
    kind: "typed_module",
  };
}

function compile(work, name, ir) {
  const source = join(work, `${name}.vkf`);
  const typedIr = join(work, `${name}-typed-ir.json`);
  writeFileSync(source, "# hardcoded typed-IR ABI fixture\n", "utf8");
  writeFileSync(typedIr, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
  return spawnSync(
    x64Artifact,
    ["--source", source, "--typed-ir", typedIr],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    },
  );
}

function makeWork(prefix) {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  return mkdtempSync(join(workRoot, prefix));
}

test("nested typed envelopes cross aggregate calls exactly", () => {
  const work = makeWork("i31-aggregate-call-");
  try {
    const compiled = compile(work, "aggregate-call", moduleIr());
    assert.equal(compiled.error, undefined, `failed to start ${x64Artifact}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    const summary = JSON.parse(compiled.stdout);
    const machine = JSON.parse(readFileSync(summary.machine_ir_path, "utf8"));
    const calls = machine.entry.instructions
      .filter((item) => item.kind === "call")
      .map(({ argument_count, result_count, symbol }) => ({ argument_count, result_count, symbol }));
    assert.deepEqual(calls, [
      {
        argument_count: 0,
        result_count: 57,
        symbol: "__vkf_module_stage__produce",
      },
      {
        argument_count: 57,
        result_count: 1,
        symbol: "__vkf_module_stage__matches",
      },
    ]);
    const run = spawnSync(summary.artifact_path, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `aggregate-call artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "true");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("mismatched aggregate call shapes fail before artifact output", () => {
  const work = makeWork("i31-malformed-aggregate-call-");
  try {
    const compiled = compile(work, "malformed-aggregate-call", moduleIr(true));
    assert.equal(compiled.error, undefined, `failed to start ${x64Artifact}: ${compiled.error}`);
    assert.notEqual(compiled.status, 0, "malformed aggregate call unexpectedly compiled");
    assert.match(compiled.stderr, /call argument (?:structure|width) mismatch/);
    assert.equal(
      existsSync(join(work, ".vkfbuild", "malformed-aggregate-call", `malformed-aggregate-call${executableSuffix}`)),
      false,
      "malformed aggregate call emitted an artifact",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
