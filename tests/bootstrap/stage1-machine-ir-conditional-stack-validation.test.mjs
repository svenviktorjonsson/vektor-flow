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
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : join(root, "build", "050-b00", "bin", process.platform === "win32" ? "Release" : "");
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);

function compile(source, artifact) {
  return spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
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

test("VKF recomputes exact Stage 0 stack maxima for the conditional module", () => {
  const work = makeWork("i56-conditional-max-");
  try {
    copyProbeModules(work);
    const source = join(work, "conditional-max.vkf");
    const artifact = join(work, `conditional-max${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_positive_conditional_stack_maxima("positive", "x")',
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
    assert.equal(run.error, undefined, `conditional validator did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "[1, 1, 2]");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects unsupported conditional machine opcodes before output", () => {
  const work = makeWork("i56-conditional-op-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /            mir_simple\("ordered_greater_f64"\),/,
      '            mir_simple("unsupported_probe"),',
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "opcode mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "conditional-op.vkf");
    const artifact = join(work, `conditional-op${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_positive_conditional_stack_maxima("positive", "x")',
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
      "conditional validator omitted its unsupported-opcode diagnostic",
    );
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `unsupported-opcode probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unsupported conditional opcode produced output");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects conditional machine-function stack underflow before output", () => {
  const work = makeWork("i56-conditional-under-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /        instructions: \[\r?\n            mir_load_local\(0\),\r?\n            mir_push_f64\(if_statement\.condition\.right\.value\),/,
      '        instructions: [\n            mir_simple("ordered_greater_f64"),\n            mir_push_f64(if_statement.condition.right.value),',
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "underflow mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "conditional-under.vkf");
    const artifact = join(work, `conditional-under${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_positive_conditional_stack_maxima("positive", "x")',
        "",
      ].join("\n"),
      "utf8",
    );

    const compiled = compile(source, artifact);
    assert.equal(compiled.error, undefined, `failed to start ${compiler}: ${compiled.error}`);
    assert.equal(compiled.status, 0, compiled.stderr);
    assert.ok(
      readFileSync(artifact).includes(Buffer.from("machine IR stack underflow")),
      "conditional validator omitted its stack-underflow diagnostic",
    );
    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `stack-underflow probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "conditional stack underflow produced output");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
