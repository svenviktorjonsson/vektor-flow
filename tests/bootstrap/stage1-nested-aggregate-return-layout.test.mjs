import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

function compile(source, artifact) {
  return spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
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

test("nested heterogeneous return layouts preserve deep numeric leaves", () => {
  const work = makeWork("i31b-nested-return-");
  try {
    const source = join(work, "nested-return.vkf");
    const artifact = join(work, `nested-return${executableSuffix}`);
    writeFileSync(
      source,
      [
        "NumericConst: (kind:str,value:num,type:str)",
        "NumericLoad: (kind:str,name:str,type:str)",
        "NumericMultiply: (kind:str,left:NumericLoad,left_type:str,op:str,right:NumericConst,right_type:str,type:str)",
        "NumericStatement: (expr:NumericMultiply,kind:str)",
        "NumericBlock: (body:[NumericStatement:1],kind:str)",
        "NumericParameter: (kind:str,name:str,type:str,variadic_named:bit,variadic_positional:bit,default:any)",
        "NumericSignature: (kind:str,params:[str:1],return_type:str,type:str)",
        "NumericFunction: (body:NumericBlock,kind:str,name:str,params:[NumericParameter:1],representation_type:str,return_type:str,signature:NumericSignature,type:str)",
        "make_module(function:NumericFunction):",
        "    (entry:(",
        "        instructions:[",
        '            (argument_count:0,has_error_handler:false,kind:"call",may_error:false,provided_parameter_mask:0,result_count:1,symbol:"cpu_count",uses_parameter_mask:false),',
        '            (argument_count:1,has_error_handler:false,kind:"call",may_error:false,provided_parameter_mask:1,result_count:1,symbol:function.name,uses_parameter_mask:false),',
        '            (kind:"return_f64",)',
        "        ],",
        "        local_classes:[],",
        "        locals:[],",
        "        max_stack:1,",
        "        may_error:false,",
        '        name:"entry",',
        "        owned_f64_list_locals:[],",
        "        owned_string_locals:[],",
        "        parameter_is_numeric_scalar:[],",
        "        parameter_mask_local:null,",
        "        parameters:[],",
        "        result_is_dynamic_f64_list:false,",
        "        result_is_numeric_scalar:false",
        "    ),functions:[",
        "        (",
        '            instructions:[(kind:"system_cpu_count",),(kind:"return_f64",)],',
        "            local_classes:[],",
        "            locals:[],",
        "            max_stack:1,",
        "            may_error:false,",
        '            name:"cpu_count",',
        "            owned_f64_list_locals:[],",
        "            owned_string_locals:[],",
        "            parameter_is_numeric_scalar:[],",
        "            parameter_mask_local:null,",
        "            parameters:[],",
        "            result_is_dynamic_f64_list:false,",
        "            result_is_numeric_scalar:true",
        "        ),",
        "        (",
        "            instructions:[",
        '            (index:0,kind:"load_local"),',
        '            (kind:"push_f64",value:function.body.body.0.expr.right.value),',
        '            (kind:"multiply_f64",),',
        '            (kind:"return_f64",)',
        "            ],",
        '            local_classes:["f64"],',
        '            locals:["value"],',
        "            max_stack:2,",
        "            may_error:false,",
        "            name:function.name,",
        "            owned_f64_list_locals:[],",
        "            owned_string_locals:[],",
        "            parameter_is_numeric_scalar:[true],",
        "            parameter_mask_local:null,",
        '            parameters:["value"],',
        "            result_is_dynamic_f64_list:false,",
        "            result_is_numeric_scalar:true",
        "        )",
        '    ],output_count:1,output_kind:"f64",output_tokens:[],outputs:[],schema:"vektorflow.machine_ir",string_bytes:77,version:23)',
        "function: (",
        '    body:(body:[(expr:(kind:"binary_op",left:(kind:"load",name:"value",type:"num"),left_type:"num",op:"STAR",right:(kind:"const",value:2,type:"int"),right_type:"int",type:"num"),kind:"expr_stmt")],kind:"block"),',
        '    kind:"function",',
        '    name:"twice",',
        '    params:[(default:null,kind:"param",name:"value",type:"num",variadic_named:false,variadic_positional:false)],',
        '    representation_type:"num",',
        '    return_type:"num",',
        '    signature:(kind:"function_signature",params:["num"],return_type:"num",type:"fn(num)->num"),',
        '    type:"fn(num)->num"',
        ")",
        "module: make_module(function)",
        ":: module.functions.1.instructions.1.value",
        "",
      ].join("\n"),
      "utf8",
    );
    const compiled = compile(source, artifact);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `nested return artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "2");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("exact nested layouts keep the no-projection call path", () => {
  const work = makeWork("i31b-exact-return-");
  try {
    const source = join(work, "exact-return.vkf");
    const artifact = join(work, `exact-return${executableSuffix}`);
    writeFileSync(
      source,
      [
        "ExactRight: (kind:str,value:num)",
        "ExactPayload: (left:num,right:ExactRight)",
        "identity(value:ExactPayload): value",
        'payload: (left:1,right:(kind:"const",value:2))',
        "returned: identity(payload)",
        ":: returned.right.value",
        "",
      ].join("\n"),
      "utf8",
    );
    const compiled = compile(source, artifact);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `exact-layout artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "2");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("nested scalar any fields retain ordinary numeric lowering", () => {
  const work = makeWork("i31b-scalar-any-");
  try {
    const source = join(work, "scalar-any.vkf");
    const artifact = join(work, `scalar-any${executableSuffix}`);
    writeFileSync(
      source,
      [
        "AnyBox: (value:any,)",
        "increment(box:AnyBox) -> num: box.value + 1",
        "box: (value:2,)",
        ":: increment(box)",
        "",
      ].join("\n"),
      "utf8",
    );
    const compiled = compile(source, artifact);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `scalar-any artifact did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "3");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("mismatched nested return inputs fail before artifact output", () => {
  const work = makeWork("i31b-malformed-return-");
  try {
    const source = join(work, "malformed-return.vkf");
    const artifact = join(work, `malformed-return${executableSuffix}`);
    writeFileSync(
      source,
      [
        "make_module(value:num):",
        "    (functions:[(instructions:[(kind:\"push\",value:value)])])",
        'module: make_module((kind:"not_numeric",))',
        ":: module.functions.0.instructions.0.value",
        "",
      ].join("\n"),
      "utf8",
    );
    const compiled = compile(source, artifact);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.notEqual(compiled.status, 0, "mismatched nested return input unexpectedly compiled");
    assert.match(compiled.stderr, /automatic function broadcasting only descends through vectors/);
    assert.equal(existsSync(artifact), false, "malformed input emitted an artifact");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
