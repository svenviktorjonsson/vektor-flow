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

function makeWork(prefix) {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  return mkdtempSync(join(workRoot, prefix));
}

function compileResult(source, artifact) {
  return spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
}

function compile(source, artifact) {
  const result = compileResult(source, artifact);
  assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
  assert.equal(result.status, 0, result.stderr);
}

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

function copyProducerModules(work) {
  for (const moduleName of ["typed_ir", "machine_ir"]) {
    copyFileSync(
      join(root, "compiler", "self_hosted", `${moduleName}.vkf`),
      join(work, `${moduleName}.vkf`),
    );
  }
}

test("VKF lowers an exact typed numeric application to its whole MachineModule", () => {
  const work = makeWork("i35-ok-");
  try {
    const oracleSource = join(work, "oracle.vkf");
    const oracleArtifact = join(work, `oracle${executableSuffix}`);
    copyFileSync(
      join(root, "tests", "bootstrap", "fixtures", "parameter-multiply-function-module.vkf"),
      oracleSource,
    );
    compile(oracleSource, oracleArtifact);
    const oracleBuild = join(work, ".vkfbuild", "oracle");
    const typed = JSON.parse(readFileSync(join(oracleBuild, "typed-ir.json"), "utf8"));
    const machine = JSON.parse(readFileSync(join(oracleBuild, "machine-ir.json"), "utf8"));
    const typedFunction = typed.body.find(
      (item) => item.kind === "function" && item.name === "twice",
    );
    const expectedApplication = {
      body: [typedFunction, typed.body.at(-1)],
      kind: typed.kind,
    };
    const applicationPaths = structuralLeafPaths(expectedApplication);
    const machinePaths = structuralLeafPaths(machine);

    copyProducerModules(work);
    const source = join(work, "producer.vkf");
    const artifact = join(work, `producer${executableSuffix}`);
    writeFileSync(
      source,
      [
        "typed: .typed_ir",
        "mir: .machine_ir",
        'application: typed.typed_numeric_parameter_multiply_application("twice", "value", 2)',
        "matches: mir.mir_numeric_parameter_multiply_typed_module_matches(application)",
        'matches?! "typed numeric application does not match MachineModule lowering"',
        ":: matches",
        "module: mir.mir_lower_numeric_parameter_multiply_typed_module(application)",
        ...applicationPaths.map((path) => `:: application.${path}`),
        ...machinePaths.map((path) => `:: module.${path}`),
        "",
      ].join("\n"),
      "utf8",
    );
    compile(source, artifact);

    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `producer did not start: ${run.error}`);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      run.stdout.trim().split(/\r?\n/),
      [
        "true",
        ...applicationPaths.map((path) =>
          renderObservedValue(valueAtPath(expectedApplication, path))
        ),
        ...machinePaths.map((path) => renderObservedValue(valueAtPath(machine, path))),
      ],
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("malformed typed numeric applications reject before MachineModule output", () => {
  const work = makeWork("i35-bad-");
  try {
    copyProducerModules(work);
    const typedPath = join(work, "typed_ir.vkf");
    const originalTyped = readFileSync(typedPath, "utf8");
    const malformedTyped = originalTyped.replace(
      '            full_name: "io.print",',
      '            full_name: "io.invalid",',
    );
    assert.notEqual(malformedTyped, originalTyped, "typed application mutation did not apply");
    writeFileSync(typedPath, malformedTyped, "utf8");

    const source = join(work, "malformed.vkf");
    const artifact = join(work, `malformed${executableSuffix}`);
    writeFileSync(
      source,
      [
        "typed: .typed_ir",
        "mir: .machine_ir",
        'application: typed.typed_numeric_parameter_multiply_application("twice", "value", 2)',
        "module: mir.mir_lower_numeric_parameter_multiply_typed_module(application)",
        ":: module.schema",
        "",
      ].join("\n"),
      "utf8",
    );
    compile(source, artifact);
    assert.equal(existsSync(artifact), true);

    const run = spawnSync(artifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(run.error, undefined, `malformed producer did not start: ${run.error}`);
    assert.notEqual(run.status, 0, "malformed application unexpectedly produced output");
    assert.equal(run.stdout, "");
    assert.match(
      readFileSync(artifact).toString("latin1"),
      /typed numeric application does not match MachineModule lowering/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("structurally short typed applications reject at the private layout seam", () => {
  const work = makeWork("i35-short-");
  try {
    copyProducerModules(work);
    const source = join(work, "short.vkf");
    const artifact = join(work, `short${executableSuffix}`);
    writeFileSync(
      source,
      [
        "typed: .typed_ir",
        "mir: .machine_ir",
        'application: typed.typed_numeric_parameter_multiply_application("twice", "value", 2)',
        "short: (body:[application.body.0],kind:application.kind)",
        "module: mir.mir_lower_numeric_parameter_multiply_typed_module(short)",
        ":: module.schema",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = compileResult(source, artifact);
    assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
    assert.notEqual(result.status, 0, "short application unexpectedly compiled");
    assert.equal(existsSync(artifact), false);
    assert.match(result.stderr, /machine IR call argument structure mismatch/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
