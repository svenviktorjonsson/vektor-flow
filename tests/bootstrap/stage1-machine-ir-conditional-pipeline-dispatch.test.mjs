import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const defaultNativeBin = process.platform === "win32"
  ? join(root, "build", "050-b00", "bin", "Release")
  : join(root, "build", "050-b00", "bin");
const nativeBin = process.env.VKF_NATIVE_BIN
  ? resolve(process.env.VKF_NATIVE_BIN)
  : defaultNativeBin;
const compiler = join(nativeBin, `vkf-strict${executableSuffix}`);
const outputNewline = process.platform === "win32" ? "\r\n" : "\n";
const componentName = "machine_ir.numeric_positive_conditional.typed_module_pipeline";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeWork(prefix) {
  const workRoot = process.env.VKF_TEST_WORK_ROOT
    ? resolve(process.env.VKF_TEST_WORK_ROOT)
    : join(root, ".work");
  mkdirSync(workRoot, { recursive: true });
  return mkdtempSync(join(workRoot, prefix));
}

function compile(source, artifact) {
  const result = spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
  assert.equal(result.error, undefined, `compile did not start: ${result.error}`);
  assert.equal(result.status, 0, result.stderr);
}

function dispatch({ artifact, oracle, output, provenance, source }) {
  return spawnSync(
    compiler,
    [
      "--vkf-internal-stage-component",
      componentName,
      artifact,
      source,
      oracle,
      output,
      provenance,
    ],
    { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
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

function prepareTracer(work) {
  for (const moduleName of ["typed_ir", "machine_ir"]) {
    copyFileSync(
      join(root, "compiler", "self_hosted", `${moduleName}.vkf`),
      join(work, `${moduleName}.vkf`),
    );
  }

  const oracleSource = join(work, "oracle.vkf");
  const oracleArtifact = join(work, `oracle${executableSuffix}`);
  copyFileSync(
    join(root, "tests", "bootstrap", "fixtures", "positive-conditional-module.vkf"),
    oracleSource,
  );
  compile(oracleSource, oracleArtifact);
  const machine = JSON.parse(readFileSync(
    join(work, ".vkfbuild", "oracle", "machine-ir.json"),
    "utf8",
  ));
  const paths = structuralLeafPaths(machine);
  const expected = paths
    .map((path) => renderObservedValue(valueAtPath(machine, path)))
    .join(outputNewline) + outputNewline;
  const oracle = join(work, "machine-module-oracle.txt");
  writeFileSync(oracle, expected, "utf8");

  const source = join(work, "conditional-typed-module-lowering.vkf");
  const artifact = join(work, `conditional-typed-module-lowering${executableSuffix}`);
  writeFileSync(
    source,
    [
      "typed: .typed_ir",
      "mir: .machine_ir",
      'application: typed.typed_numeric_positive_conditional_application("positive", "x")',
      "module: mir.mir_lower_numeric_positive_conditional_typed_module(application)",
      ...paths.map((path) => `:: module.${path}`),
      "",
    ].join("\n"),
    "utf8",
  );
  compile(source, artifact);
  return { artifact, expected, machine, oracle, oracleArtifact, source };
}

test("normal pipeline dispatch consumes the exact VKF conditional typed-module lowering", () => {
  const work = makeWork("i38-ok-");
  try {
    const tracer = prepareTracer(work);
    const output = join(work, `selected${executableSuffix}`);
    const provenance = join(work, "provenance.json");
    const first = dispatch({ ...tracer, output, provenance });
    assert.equal(first.error, undefined, `pipeline did not start: ${first.error}`);
    assert.equal(first.status, 0, first.stderr);

    const selectedRun = spawnSync(output, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    const oracleRun = spawnSync(tracer.oracleArtifact, [], {
      cwd: work,
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    assert.equal(selectedRun.status, 0, selectedRun.stderr);
    assert.equal(oracleRun.status, 0, oracleRun.stderr);
    assert.equal(selectedRun.stdout, oracleRun.stdout);
    assert.equal(selectedRun.stdout.trim(), "1");

    assert.deepEqual(JSON.parse(first.stdout), {
      artifact_path: resolve(output),
      component: componentName,
      implementation: "vkf_source_machine_module",
      provenance_path: resolve(provenance),
      status: "compiled",
    });
    const receiptBytes = readFileSync(provenance);
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.schema, "vektorflow.internal.machine_module_pipeline");
    assert.equal(receipt.version, 1);
    assert.equal(receipt.component, componentName);
    assert.equal(receipt.implementation, "vkf_source_machine_module");
    assert.equal(receipt.consumer, "vkf_x64_backend.machine_ir");
    assert.equal(receipt.exact_oracle_match, true);
    assert.equal(receipt.component_source_sha256, sha256(readFileSync(tracer.source)));
    const componentBytes = readFileSync(tracer.artifact);
    assert.equal(receipt.component_artifact_sha256, sha256(componentBytes));
    assert.equal(receipt.observation_sha256, sha256(Buffer.from(tracer.expected)));
    const sourceGraphMarker = componentBytes
      .toString("latin1")
      .match(/VKF-CACHE-V1:([0-9a-f]{64})/);
    assert.ok(sourceGraphMarker, "conditional producer has no source-graph marker");
    assert.equal(receipt.component_source_graph_fingerprint, sourceGraphMarker[1]);
    assert.match(
      readFileSync(output).toString("latin1"),
      new RegExp(`VKF-CACHE-V1:${sourceGraphMarker[1]}`),
    );
    assert.equal(receipt.artifact_sha256, sha256(readFileSync(output)));

    const artifactBytes = readFileSync(output);
    const repeated = dispatch({ ...tracer, output, provenance });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(repeated.stdout, first.stdout);
    assert.deepEqual(readFileSync(output), artifactBytes);
    assert.deepEqual(readFileSync(provenance), receiptBytes);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("conditional pipeline rejects mismatch, stale source, and unsafe parents atomically", () => {
  const work = makeWork("i38-r-");
  try {
    const tracer = prepareTracer(work);
    const output = join(work, `protected${executableSuffix}`);
    const provenance = join(work, "protected-provenance.json");
    writeFileSync(output, "preserve-artifact", "utf8");
    writeFileSync(provenance, "preserve-provenance", "utf8");

    const mismatchOracle = join(work, "mismatch.txt");
    writeFileSync(
      mismatchOracle,
      tracer.expected.replaceAll(
        `${outputNewline}positive${outputNewline}`,
        `${outputNewline}non_positive${outputNewline}`,
      ),
      "utf8",
    );
    const mismatch = dispatch({
      ...tracer,
      oracle: mismatchOracle,
      output,
      provenance,
    });
    assert.notEqual(mismatch.status, 0, "mismatched observation was consumed");
    assert.match(mismatch.stderr, /VKF stage component observation mismatch/);
    assert.equal(readFileSync(output, "utf8"), "preserve-artifact");
    assert.equal(readFileSync(provenance, "utf8"), "preserve-provenance");

    const blockedParent = join(work, "blocked-parent");
    writeFileSync(blockedParent, "not-a-directory", "utf8");
    const atomicOutput = join(work, `atomic-should-not-exist${executableSuffix}`);
    const unsafeParent = dispatch({
      ...tracer,
      output: atomicOutput,
      provenance: join(blockedParent, "provenance.json"),
    });
    assert.notEqual(unsafeParent.status, 0, "unsafe provenance parent was accepted");
    assert.match(unsafeParent.stderr, /stage component output parent is not a directory/);
    assert.equal(existsSync(atomicOutput), false);

    writeFileSync(tracer.source, `${readFileSync(tracer.source, "utf8")}\n# stale\n`, "utf8");
    const stale = dispatch({ ...tracer, output, provenance });
    assert.notEqual(stale.status, 0, "stale conditional producer was consumed");
    assert.match(stale.stderr, /artifact does not match its source graph/);
    assert.equal(readFileSync(output, "utf8"), "preserve-artifact");
    assert.equal(readFileSync(provenance, "utf8"), "preserve-provenance");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("conditional pipeline rejects matched unsupported opcodes and malformed labels", () => {
  const work = makeWork("i38-m-");
  try {
    const tracer = prepareTracer(work);
    const validSource = readFileSync(tracer.source, "utf8");

    const unsupportedSource = join(work, "unsupported-opcode.vkf");
    const unsupportedArtifact = join(work, `unsupported-opcode${executableSuffix}`);
    const unsupportedText = validSource.replace(
      ":: module.functions.1.instructions.2.kind",
      ':: "ordered_less_equal_f64"',
    );
    assert.notEqual(unsupportedText, validSource, "opcode mutation did not apply");
    writeFileSync(unsupportedSource, unsupportedText, "utf8");
    compile(unsupportedSource, unsupportedArtifact);
    const unsupportedOracle = join(work, "unsupported-opcode-oracle.txt");
    writeFileSync(
      unsupportedOracle,
      tracer.expected.replace(
        `${outputNewline}ordered_greater_f64${outputNewline}`,
        `${outputNewline}ordered_less_equal_f64${outputNewline}`,
      ),
      "utf8",
    );
    const unsupportedOutput = join(work, `unsupported-should-not-exist${executableSuffix}`);
    const unsupportedProvenance = join(work, "unsupported-should-not-exist.json");
    const unsupported = dispatch({
      artifact: unsupportedArtifact,
      oracle: unsupportedOracle,
      output: unsupportedOutput,
      provenance: unsupportedProvenance,
      source: unsupportedSource,
    });
    assert.notEqual(unsupported.status, 0, "unsupported conditional opcode was consumed");
    assert.match(
      unsupported.stderr,
      /unsupported conditional tracer opcode ordered_less_equal_f64 at leaf 47/,
    );
    assert.equal(existsSync(unsupportedOutput), false);
    assert.equal(existsSync(unsupportedProvenance), false);

    const malformedSource = join(work, "malformed-label.vkf");
    const malformedArtifact = join(work, `malformed-label${executableSuffix}`);
    const malformedText = validSource.replace(
      ":: module.functions.1.instructions.3.label",
      ":: 2",
    );
    assert.notEqual(malformedText, validSource, "label mutation did not apply");
    writeFileSync(malformedSource, malformedText, "utf8");
    compile(malformedSource, malformedArtifact);
    const malformedOracle = join(work, "malformed-label-oracle.txt");
    writeFileSync(
      malformedOracle,
      tracer.expected.replace(
        `${outputNewline}jump_if_false${outputNewline}1${outputNewline}`,
        `${outputNewline}jump_if_false${outputNewline}2${outputNewline}`,
      ),
      "utf8",
    );
    const malformedOutput = join(work, `malformed-should-not-exist${executableSuffix}`);
    const malformedProvenance = join(work, "malformed-should-not-exist.json");
    const malformed = dispatch({
      artifact: malformedArtifact,
      oracle: malformedOracle,
      output: malformedOutput,
      provenance: malformedProvenance,
      source: malformedSource,
    });
    assert.notEqual(malformed.status, 0, "malformed conditional label was consumed");
    assert.match(
      malformed.stderr,
      /malformed conditional tracer observation at leaf 49: expected 1/,
    );
    assert.equal(existsSync(malformedOutput), false);
    assert.equal(existsSync(malformedProvenance), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
