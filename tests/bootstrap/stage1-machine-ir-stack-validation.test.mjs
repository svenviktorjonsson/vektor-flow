import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
const defaultNativeBin = process.platform === "win32"
  ? join(root, "build", "050-b00", "bin", "Release")
  : join(root, "build", "050-b00", "bin");
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : defaultNativeBin;
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

function compile(source, artifact) {
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

function makeWork(prefix) {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  return mkdtempSync(join(workRoot, prefix));
}

function copyProbeModules(work) {
  for (const moduleName of ["typed_ir", "machine_ir", "machine_ir_validation"]) {
    copyFileSync(
      join(root, "compiler", "self_hosted", `${moduleName}.vkf`),
      join(work, `${moduleName}.vkf`),
    );
  }
}

test("VKF recomputes exact Stage 0 stack maxima for the reusable numeric module", () => {
  const work = makeWork("i33b-max-");
  try {
    copyProbeModules(work);
    const source = join(work, "max.vkf");
    const artifact = join(work, `max${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
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
    assert.equal(run.error, undefined, `stack-maxima probe did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "[1, 1, 2]");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects unsupported reusable machine opcodes before output", () => {
  const work = makeWork("i33b-op-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /        mir_load_local\(0\),/,
      '        mir_simple("unsupported_probe"),',
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "unsupported-opcode mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "op.vkf");
    const artifact = join(work, `op${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
        "",
      ].join("\n"),
      "utf8",
    );

    const compiled = compile(source, artifact);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.ok(
      readFileSync(artifact).includes(Buffer.from(
        "machine IR stack validation encountered an unsupported opcode",
      )),
      "unsupported-opcode artifact omitted the exact validator diagnostic",
    );

    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `unsupported-opcode probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unsupported-opcode probe unexpectedly succeeded");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects reusable machine-function stack underflow before output", () => {
  const work = makeWork("i33b-under-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /        mir_load_local\(0\),\r?\n        mir_push_f64\(right_value\),/,
      "        mir_multiply_f64(),\n        mir_push_f64(right_value),",
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "underflow mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "under.vkf");
    const artifact = join(work, `under${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
        "",
      ].join("\n"),
      "utf8",
    );

    const compiled = compile(source, artifact);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.ok(
      readFileSync(artifact).includes(Buffer.from("machine IR stack underflow")),
      "underflow artifact omitted the exact validator diagnostic",
    );

    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `stack-underflow probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "stack-underflow probe unexpectedly succeeded");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects reusable numeric entry stack imbalance before output", () => {
  const work = makeWork("i66-entry-balance-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /(_mir_numeric_entry\(function_name:str\):[\s\S]*?_mir_call_no_handler\(function_name, 1, 1, 1\),\r?\n)            mir_return_f64\(\)/,
      "$1            mir_push_f64(0)",
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "entry-imbalance mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "entry-balance.vkf");
    const artifact = join(work, `entry-balance${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
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
    assert.equal(run.error, undefined, `entry-balance probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unbalanced numeric entry unexpectedly succeeded");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects reusable numeric function stack imbalance before output", () => {
  const work = makeWork("i67-function-balance-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /(mir_numeric_parameter_multiply_instructions\(right_value:num\):[\s\S]*?        mir_multiply_f64\(\),\r?\n)        mir_return_f64\(\)/,
      "$1        mir_push_f64(0)",
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "function-imbalance mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "function-balance.vkf");
    const artifact = join(work, `function-balance${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
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
    assert.equal(run.error, undefined, `function-balance probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unbalanced numeric function unexpectedly succeeded");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects reusable numeric helper stack imbalance before output", () => {
  const work = makeWork("i68-helper-balance-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /(_mir_numeric_cpu_count_function\(\):[\s\S]*?instructions: \[mir_simple\("system_cpu_count"\), )mir_return_f64\(\)/,
      "$1mir_push_f64(0)",
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "helper-imbalance mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "helper-balance.vkf");
    const artifact = join(work, `helper-balance${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
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
    assert.equal(run.error, undefined, `helper-balance probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unbalanced numeric helper unexpectedly succeeded");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects a reusable numeric entry without a return terminator", () => {
  const work = makeWork("i87-entry-terminator-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /(_mir_numeric_entry\(function_name:str\):[\s\S]*?_mir_call_no_handler\(function_name, 1, 1, 1\),\r?\n)            mir_return_f64\(\)/,
      '$1            mir_local("store_local", 0)',
    );
    assert.notEqual(
      mutatedMachineIr,
      originalMachineIr,
      "entry-terminator mutation did not apply",
    );
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "entry-terminator.vkf");
    const artifact = join(work, `entry-terminator${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
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
    assert.equal(run.error, undefined, `entry-terminator probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unterminated numeric entry produced output");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects a reusable numeric helper without a return terminator", () => {
  const work = makeWork("i88-helper-terminator-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /(_mir_numeric_cpu_count_function\(\):[\s\S]*?instructions: \[mir_simple\("system_cpu_count"\), )mir_return_f64\(\)/,
      '$1mir_local("store_local", 0)',
    );
    assert.notEqual(
      mutatedMachineIr,
      originalMachineIr,
      "helper-terminator mutation did not apply",
    );
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "helper-terminator.vkf");
    const artifact = join(work, `helper-terminator${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
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
    assert.equal(run.error, undefined, `helper-terminator probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unterminated numeric helper produced output");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
