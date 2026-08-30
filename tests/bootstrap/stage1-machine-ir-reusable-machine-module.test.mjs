import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

function compileResult(source, artifact) {
  return spawnSync(
    compiler,
    [
      "-b",
      source,
      "-o",
      artifact,
      "--diagnostics",
      "--optimizer-policy",
      "mask-0",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    },
  );
}

function compile(source, artifact) {
  const result = compileResult(source, artifact);
  assert.equal(result.error, undefined, `failed to start ${compiler}: ${result.error}`);
  assert.equal(result.status, 0, result.stderr);
}

function makeWork(prefix) {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  return mkdtempSync(join(workRoot, prefix));
}

const expectedMachineModule = {
  entry: {
    instructions: [
      {
        argument_count: 0,
        has_error_handler: false,
        kind: "call",
        may_error: false,
        provided_parameter_mask: 0,
        result_count: 1,
        symbol: "cpu_count",
        uses_parameter_mask: false,
      },
      {
        argument_count: 1,
        has_error_handler: false,
        kind: "call",
        may_error: false,
        provided_parameter_mask: 1,
        result_count: 1,
        symbol: "twice",
        uses_parameter_mask: false,
      },
      { kind: "return_f64" },
    ],
    local_classes: [],
    locals: [],
    max_stack: 1,
    may_error: false,
    name: "$entry",
    owned_f64_list_locals: [],
    owned_string_locals: [],
    parameter_is_numeric_scalar: [],
    parameter_mask_local: null,
    parameters: [],
    result_is_dynamic_f64_list: false,
    result_is_numeric_scalar: false,
  },
  functions: [
    {
      instructions: [
        { kind: "system_cpu_count" },
        { kind: "return_f64" },
      ],
      local_classes: [],
      locals: [],
      max_stack: 1,
      may_error: false,
      name: "cpu_count",
      owned_f64_list_locals: [],
      owned_string_locals: [],
      parameter_is_numeric_scalar: [],
      parameter_mask_local: null,
      parameters: [],
      result_is_dynamic_f64_list: false,
      result_is_numeric_scalar: true,
    },
    {
      instructions: [
        { index: 0, kind: "load_local" },
        { kind: "push_f64", value: 2 },
        { kind: "multiply_f64" },
        { kind: "return_f64" },
      ],
      local_classes: ["f64"],
      locals: ["value"],
      max_stack: 2,
      may_error: false,
      name: "twice",
      owned_f64_list_locals: [],
      owned_string_locals: [],
      parameter_is_numeric_scalar: [true],
      parameter_mask_local: null,
      parameters: ["value"],
      result_is_dynamic_f64_list: false,
      result_is_numeric_scalar: true,
    },
  ],
  output_count: 1,
  output_kind: "f64",
  output_tokens: [],
  outputs: [],
  schema: "vektorflow.machine_ir",
  string_bytes: 77,
  version: 23,
};

function structuralLeafPaths(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.length === 0
      ? [prefix]
      : value.flatMap((item, index) => structuralLeafPaths(item, `${prefix}.${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value).flatMap((key) =>
      structuralLeafPaths(value[key], prefix ? `${prefix}.${key}` : key)
    );
  }
  return [prefix];
}

function valueAtPath(value, path) {
  return path.split(".").reduce((owner, key) => owner[key], value);
}

function renderObservedValue(value) {
  if (Array.isArray(value)) return "[]";
  if (value === null) return "null";
  return String(value);
}

const machineModuleObservationPaths = structuralLeafPaths(expectedMachineModule);

test("VKF lowers one reusable complete numeric MachineModule", () => {
  const work = makeWork("i32-reusable-machine-module-");
  try {
    const oracleSource = join(work, "parameter-multiply-function-module.vkf");
    const oracleArtifact = join(work, `parameter-multiply-function-module${executableSuffix}`);
    copyFileSync(
      join(root, "tests", "bootstrap", "fixtures", "parameter-multiply-function-module.vkf"),
      oracleSource,
    );
    compile(oracleSource, oracleArtifact);
    const oracleBuild = join(work, ".vkfbuild", "parameter-multiply-function-module");
    assert.deepEqual(
      JSON.parse(readFileSync(join(oracleBuild, "machine-ir.json"), "utf8")),
      expectedMachineModule,
    );

    copyFileSync(join(root, "compiler", "self_hosted", "typed_ir.vkf"), join(work, "typed_ir.vkf"));
    copyFileSync(join(root, "compiler", "self_hosted", "machine_ir.vkf"), join(work, "machine_ir.vkf"));
    const probeSource = join(work, "reusable-machine-module-probe.vkf");
    const probeArtifact = join(work, `reusable-machine-module-probe${executableSuffix}`);
    writeFileSync(
      probeSource,
      [
        "typed: .typed_ir",
        "mir: .machine_ir",
        'function: typed.typed_numeric_parameter_multiply_function("twice", "value", 2)',
        "module: mir.mir_lower_numeric_parameter_multiply_function_module(function)",
        ...machineModuleObservationPaths.map((path) => `:: module.${path}`),
        "",
      ].join("\n"),
      "utf8",
    );
    compile(probeSource, probeArtifact);
    const run = spawnSync(probeArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `MachineModule probe did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      run.stdout.trim().split(/\r?\n/),
      machineModuleObservationPaths.map((path) =>
        renderObservedValue(valueAtPath(expectedMachineModule, path))
      ),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("malformed typed applications never produce a MachineModule artifact", () => {
  const work = makeWork("i32-malformed-machine-module-");
  try {
    copyFileSync(join(root, "compiler", "self_hosted", "machine_ir.vkf"), join(work, "machine_ir.vkf"));
    const source = join(work, "malformed-machine-module.vkf");
    const artifact = join(work, `malformed-machine-module${executableSuffix}`);
    writeFileSync(
      source,
      [
        "mir: .machine_ir",
        "function: (",
        '    body:(body:[(expr:(kind:"const",value:2,type:"int"),kind:"expr_stmt")],kind:"block"),',
        '    kind:"function",',
        '    name:"twice",',
        '    params:[(default:null,kind:"param",name:"value",type:"num",variadic_named:false,variadic_positional:false)],',
        '    representation_type:"num",',
        '    return_type:"num",',
        '    signature:(kind:"function_signature",params:["num"],return_type:"num",type:"fn(num)->num"),',
        '    type:"fn(num)->num"',
        ")",
        "module: mir.mir_lower_numeric_parameter_multiply_function_module(function)",
        ":: module.schema",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = compileResult(source, artifact);
    assert.equal(result.error, undefined, `failed to start ${compiler}: ${result.error}`);
    assert.notEqual(result.status, 0, "malformed typed application unexpectedly lowered");
    assert.notEqual(result.status, 3221225477, "compiler crashed with 0xC0000005");
    assert.notEqual(result.status, -1073741819, "compiler crashed with 0xC0000005");
    assert.match(result.stderr, /call argument structure mismatch/);
    assert.equal(existsSync(artifact), false, "malformed input emitted an artifact");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
