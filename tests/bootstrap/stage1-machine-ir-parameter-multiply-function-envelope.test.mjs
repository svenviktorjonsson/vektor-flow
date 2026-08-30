import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin");
const compiler = join(nativeBin, `vkf${executableSuffix}`);
const fallbackBin = process.env.VKF_FALLBACK_BIN
  ? resolve(process.env.VKF_FALLBACK_BIN)
  : nativeBin;
const fallbackArtifact = join(fallbackBin, `vkf_compiler_artifact_smoke${executableSuffix}`);

function compile(source) {
  const result = spawnSync(
    compiler,
    [
      "--source",
      source,
      "--aot",
      "--fallback-artifact",
      fallbackArtifact,
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
  assert.equal(result.error, undefined, `failed to start ${compiler}: ${result.error}`);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runArtifact(artifact, cwd) {
  return process.platform === "win32" && artifact.endsWith(".cmd")
    ? spawnSync("cmd.exe", ["/d", "/c", artifact], {
      cwd,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    })
    : spawnSync(artifact, [], {
      cwd,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
}

test("VKF constructs exact typed numeric function and Machine IR primitives", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-parameter-multiply-function-envelope-"));
  try {
    const oracleSource = join(work, "parameter-multiply-function-module.vkf");
    copyFileSync(
      join(root, "tests", "bootstrap", "fixtures", "parameter-multiply-function-module.vkf"),
      oracleSource,
    );
    compile(oracleSource);

    const oracleBuild = join(work, ".vkfbuild", "parameter-multiply-function-module");
    const typed = JSON.parse(readFileSync(join(oracleBuild, "typed-ir.json"), "utf8"));
    const machine = JSON.parse(readFileSync(join(oracleBuild, "machine-ir.json"), "utf8"));
    const typedFunction = typed.body.find((item) => item.kind === "function" && item.name === "twice");
    assert.deepEqual(typedFunction, {
      body: {
        body: [{
          expr: {
            kind: "binary_op",
            left: { kind: "load", name: "value", type: "num" },
            left_type: "num",
            op: "STAR",
            right: { kind: "const", type: "int", value: 2 },
            right_type: "int",
            type: "num",
          },
          kind: "expr_stmt",
        }],
        kind: "block",
      },
      kind: "function",
      name: "twice",
      params: [{
        default: null,
        kind: "param",
        name: "value",
        type: "num",
        variadic_named: false,
        variadic_positional: false,
      }],
      representation_type: "num",
      return_type: "num",
      signature: {
        kind: "function_signature",
        params: ["num"],
        return_type: "num",
        type: "fn(num)->num",
      },
      type: "fn(num)->num",
    });

    const machineFunction = machine.functions.find((item) => item.name === "twice");
    assert.deepEqual(machineFunction.instructions, [
      { index: 0, kind: "load_local" },
      { kind: "push_f64", value: 2 },
      { kind: "multiply_f64" },
      { kind: "return_f64" },
    ]);

    copyFileSync(
      join(root, "compiler", "self_hosted", "typed_ir.vkf"),
      join(work, "typed_ir.vkf"),
    );
    copyFileSync(
      join(root, "compiler", "self_hosted", "machine_ir.vkf"),
      join(work, "machine_ir.vkf"),
    );
    const probeSource = join(work, "parameter-multiply-function-envelope-probe.vkf");
    writeFileSync(
      probeSource,
      [
        "typed: .typed_ir",
        "mir: .machine_ir",
        'function: typed.typed_numeric_parameter_multiply_function("twice", "value", 2)',
        "instructions: mir.mir_numeric_parameter_multiply_instructions(2)",
        ":: mir.mir_numeric_parameter_multiply_function_matches(function)",
        ":: function.kind",
        ":: function.name",
        ":: function.params.0.default = null",
        ":: function.params.0.kind",
        ":: function.params.0.name",
        ":: function.params.0.type",
        ":: ~function.params.0.variadic_named",
        ":: ~function.params.0.variadic_positional",
        ":: function.representation_type",
        ":: function.return_type",
        ":: function.signature.kind",
        ":: function.signature.params.0",
        ":: function.signature.return_type",
        ":: function.signature.type",
        ":: function.type",
        ":: function.body.kind",
        ":: function.body.body.0.kind",
        ":: function.body.body.0.expr.kind",
        ":: function.body.body.0.expr.left.kind",
        ":: function.body.body.0.expr.left.name",
        ":: function.body.body.0.expr.left.type",
        ":: function.body.body.0.expr.left_type",
        ":: function.body.body.0.expr.op",
        ":: function.body.body.0.expr.right.kind",
        ":: function.body.body.0.expr.right.value",
        ":: function.body.body.0.expr.right.type",
        ":: function.body.body.0.expr.right_type",
        ":: function.body.body.0.expr.type",
        ":: instructions.0.kind",
        ":: instructions.0.index",
        ":: instructions.1.kind",
        ":: instructions.1.value",
        ":: instructions.2.kind",
        ":: instructions.3.kind",
        "",
      ].join("\n"),
      "utf8",
    );

    const probeSummary = compile(probeSource);
    const probeBuild = join(work, ".vkfbuild", "parameter-multiply-function-envelope-probe");
    const probeTyped = JSON.parse(readFileSync(join(probeBuild, "typed-ir.json"), "utf8"));
    assert.deepEqual(
      probeTyped.body
        .filter((item) => item.kind === "store_binding")
        .map((item) => item.name)
        .filter((name) => name.endsWith("_capability") || name.endsWith("_opcode_catalog")),
      [],
      "unused imported catalog bindings leaked into executable initialization",
    );
    const run = runArtifact(probeSummary.artifact_path, work);
    assert.equal(run.error, undefined, `full-envelope probe did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split(/\r?\n/), [
      "true",
      typedFunction.kind,
      typedFunction.name,
      "true",
      typedFunction.params[0].kind,
      typedFunction.params[0].name,
      typedFunction.params[0].type,
      "true",
      "true",
      typedFunction.representation_type,
      typedFunction.return_type,
      typedFunction.signature.kind,
      typedFunction.signature.params[0],
      typedFunction.signature.return_type,
      typedFunction.signature.type,
      typedFunction.type,
      typedFunction.body.kind,
      typedFunction.body.body[0].kind,
      typedFunction.body.body[0].expr.kind,
      typedFunction.body.body[0].expr.left.kind,
      typedFunction.body.body[0].expr.left.name,
      typedFunction.body.body[0].expr.left.type,
      typedFunction.body.body[0].expr.left_type,
      typedFunction.body.body[0].expr.op,
      typedFunction.body.body[0].expr.right.kind,
      String(typedFunction.body.body[0].expr.right.value),
      typedFunction.body.body[0].expr.right.type,
      typedFunction.body.body[0].expr.right_type,
      typedFunction.body.body[0].expr.type,
      machineFunction.instructions[0].kind,
      String(machineFunction.instructions[0].index),
      machineFunction.instructions[1].kind,
      String(machineFunction.instructions[1].value),
      machineFunction.instructions[2].kind,
      machineFunction.instructions[3].kind,
    ]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects an incompatible numeric function envelope before execution", () => {
  const work = mkdtempSync(join(tmpdir(), "vkf-incompatible-function-envelope-"));
  try {
    copyFileSync(
      join(root, "compiler", "self_hosted", "machine_ir.vkf"),
      join(work, "machine_ir.vkf"),
    );
    const source = join(work, "incompatible-function-envelope.vkf");
    const artifact = join(work, `incompatible-function-envelope${executableSuffix}`);
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
        ":: mir.mir_numeric_parameter_multiply_function_matches(function)",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
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
    assert.equal(result.error, undefined, `failed to start ${compiler}: ${result.error}`);
    assert.notEqual(result.status, 0, "structurally incompatible envelope was accepted");
    assert.notEqual(result.status, 3221225477, "compiler crashed with 0xC0000005");
    assert.notEqual(result.status, -1073741819, "compiler crashed with 0xC0000005");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
