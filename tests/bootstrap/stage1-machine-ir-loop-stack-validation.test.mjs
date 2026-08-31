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

test("VKF recomputes exact Stage 0 stack maxima for the reusable loop module", () => {
  const work = makeWork("i41-max-");
  try {
    copyProbeModules(work);
    const source = join(work, "loop-max.vkf");
    const artifact = join(work, `loop-max${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_count_to_loop_stack_maxima("count_to", "limit", "value", 3)',
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
    assert.equal(run.stdout.trim(), "[1, 2]");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects unsupported loop machine opcodes before output", () => {
  const work = makeWork("i41-op-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /            mir_simple\("ordered_less_f64"\),/,
      '            mir_simple("unsupported_probe"),',
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "unsupported-opcode mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "loop-op.vkf");
    const artifact = join(work, `loop-op${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_count_to_loop_stack_maxima("count_to", "limit", "value", 3)',
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

test("VKF rejects loop machine-function stack underflow before output", () => {
  const work = makeWork("i41-under-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /            mir_push_f64\(initial_value\),/,
      '            mir_local("store_local", 1),',
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "underflow mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "loop-under.vkf");
    const artifact = join(work, `loop-under${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_count_to_loop_stack_maxima("count_to", "limit", "value", 3)',
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

test("VKF rejects a fixed-loop back edge that does not target its entry label", () => {
  const work = makeWork("i59-branch-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /            mir_branch\("jump", 0\),/,
      '            mir_branch("jump", 2),',
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "back-edge mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "loop-branch.vkf");
    const artifact = join(work, `loop-branch${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_count_to_loop_stack_maxima("count_to", "limit", "value", 3)',
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
    assert.equal(run.error, undefined, `branch-target probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "malformed fixed-loop back edge produced output");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects a fixed-loop exit branch that does not target its exit label", () => {
  const work = makeWork("i60-exit-branch-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /            mir_simple\("ordered_less_f64"\),\r?\n            mir_branch\("jump_if_false", 1\),/,
      [
        '            mir_simple("ordered_less_f64"),',
        '            mir_branch("jump_if_false", 2),',
      ].join("\n"),
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "exit-branch mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "loop-exit-branch.vkf");
    const artifact = join(work, `loop-exit-branch${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_count_to_loop_stack_maxima("count_to", "limit", "value", 3)',
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
    assert.equal(run.error, undefined, `exit-branch probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "malformed fixed-loop exit branch produced output");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("VKF rejects a fixed loop that leaves values on its terminal stack", () => {
  const work = makeWork("i63-loop-terminal-");
  try {
    copyProbeModules(work);
    const machineIrPath = join(work, "machine_ir.vkf");
    const originalMachineIr = readFileSync(machineIrPath, "utf8");
    const mutatedMachineIr = originalMachineIr.replace(
      /            mir_branch\("label", 1\),\r?\n            mir_load_local\(1\),\r?\n            mir_return_f64\(\)/,
      [
        '            mir_branch("label", 1),',
        "            mir_load_local(1),",
        "            mir_load_local(1)",
      ].join("\n"),
    );
    assert.notEqual(mutatedMachineIr, originalMachineIr, "terminal-stack mutation did not apply");
    writeFileSync(machineIrPath, mutatedMachineIr, "utf8");

    const source = join(work, "loop-terminal.vkf");
    const artifact = join(work, `loop-terminal${executableSuffix}`);
    writeFileSync(
      source,
      [
        "validation: .machine_ir_validation",
        ':: validation.machine_ir_numeric_count_to_loop_stack_maxima("count_to", "limit", "value", 3)',
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
    assert.equal(run.error, undefined, `terminal-stack probe did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "unbalanced fixed loop produced output");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
