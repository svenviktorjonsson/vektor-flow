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
const componentName = "machine_ir.numeric_parameter_multiply.stack_validation";

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

function compileComponent(work) {
  for (const moduleName of ["typed_ir", "machine_ir", "machine_ir_validation"]) {
    copyFileSync(
      join(root, "compiler", "self_hosted", `${moduleName}.vkf`),
      join(work, `${moduleName}.vkf`),
    );
  }
  const source = join(work, "validator.vkf");
  const artifact = join(work, `validator${executableSuffix}`);
  writeFileSync(
    source,
    [
      "validation: .machine_ir_validation",
      ':: validation.machine_ir_numeric_parameter_multiply_stack_maxima("twice", "value", 2)',
      "",
    ].join("\n"),
    "utf8",
  );
  const compiled = spawnSync(
    compiler,
    ["-b", source, "-o", artifact, "--diagnostics", "--optimizer-policy", "mask-0"],
    { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
  assert.equal(compiled.error, undefined, `component compile did not start: ${compiled.error}`);
  assert.equal(compiled.status, 0, compiled.stderr);
  return { artifact, source };
}

function dispatch({ artifact, oracle, provenance, selected, source, name = componentName }) {
  return spawnSync(
    compiler,
    [
      "--vkf-internal-stage-component",
      name,
      artifact,
      source,
      oracle,
      selected,
      provenance,
    ],
    { cwd: root, encoding: "utf8", timeout: 5_000, windowsHide: true },
  );
}

test("strict dispatcher selects the executed VKF machine-IR validator deterministically", () => {
  const work = makeWork("i33d-ok-");
  try {
    const { artifact, source } = compileComponent(work);
    const oracle = join(work, "oracle.txt");
    const selected = join(work, "selected.txt");
    const provenance = join(work, "provenance.json");
    writeFileSync(oracle, `[1, 1, 2]${outputNewline}`, "utf8");

    const first = dispatch({ artifact, oracle, provenance, selected, source });
    assert.equal(first.error, undefined, `dispatcher did not start: ${first.error}`);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), {
      component: componentName,
      implementation: "vkf_source",
      provenance_path: resolve(provenance),
      selected_output_path: resolve(selected),
      status: "selected",
    });
    const selectedBytes = readFileSync(selected);
    const provenanceBytes = readFileSync(provenance);
    assert.equal(selectedBytes.toString("utf8"), `[1, 1, 2]${outputNewline}`);

    const componentSource = readFileSync(source);
    const componentArtifact = readFileSync(artifact);
    const sourceGraphMarker = componentArtifact
      .toString("latin1")
      .match(/VKF-CACHE-V1:([0-9a-f]{64})/);
    assert.ok(sourceGraphMarker, "compiled VKF component has no source-graph fingerprint");
    assert.deepEqual(JSON.parse(provenanceBytes), {
      component: componentName,
      component_artifact: resolve(artifact),
      component_artifact_sha256: sha256(componentArtifact),
      component_source: resolve(source),
      component_source_graph_fingerprint: sourceGraphMarker[1],
      component_source_sha256: sha256(componentSource),
      dispatcher: "vkf-strict",
      exact_oracle_match: true,
      implementation: "vkf_source",
      observation_sha256: sha256(selectedBytes),
      oracle_output: resolve(oracle),
      schema: "vektorflow.internal.stage_component_dispatch",
      selected_output: resolve(selected),
      version: 1,
    });

    const second = dispatch({ artifact, oracle, provenance, selected, source });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.deepEqual(readFileSync(selected), selectedBytes);
    assert.deepEqual(readFileSync(provenance), provenanceBytes);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("strict dispatcher rejects unknown Stage components before execution", () => {
  const work = makeWork("i33d-name-");
  try {
    const { artifact, source } = compileComponent(work);
    const oracle = join(work, "oracle.txt");
    const selected = join(work, "selected.txt");
    const provenance = join(work, "provenance.json");
    writeFileSync(oracle, `[1, 1, 2]${outputNewline}`, "utf8");

    const rejected = dispatch({
      artifact,
      name: "machine_ir.unknown",
      oracle,
      provenance,
      selected,
      source,
    });
    assert.equal(rejected.error, undefined);
    assert.notEqual(rejected.status, 0, "unknown component was executed");
    assert.match(rejected.stderr, /unknown internal Stage component: machine_ir\.unknown/);
    assert.equal(rejected.stdout, "");
    assert.equal(existsSync(selected), false);
    assert.equal(existsSync(provenance), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("strict dispatcher preserves outputs on oracle and source-graph mismatch", () => {
  const work = makeWork("i33d-mismatch-");
  try {
    const { artifact, source } = compileComponent(work);
    const oracle = join(work, "oracle.txt");
    const selected = join(work, "selected.txt");
    const provenance = join(work, "provenance.json");
    writeFileSync(oracle, `[1, 1, 3]${outputNewline}`, "utf8");
    writeFileSync(selected, "preserve-selected", "utf8");
    writeFileSync(provenance, "preserve-provenance", "utf8");

    const mismatch = dispatch({ artifact, oracle, provenance, selected, source });
    assert.equal(mismatch.error, undefined);
    assert.notEqual(mismatch.status, 0, "mismatched Stage 0 oracle was selected");
    assert.match(mismatch.stderr, /VKF stage component observation mismatch/);
    assert.equal(mismatch.stdout, "");
    assert.equal(readFileSync(selected, "utf8"), "preserve-selected");
    assert.equal(readFileSync(provenance, "utf8"), "preserve-provenance");

    writeFileSync(oracle, `[1, 1, 2]${outputNewline}`, "utf8");
    writeFileSync(source, `${readFileSync(source, "utf8")}# stale source graph\n`, "utf8");
    const stale = dispatch({ artifact, oracle, provenance, selected, source });
    assert.equal(stale.error, undefined);
    assert.notEqual(stale.status, 0, "artifact with a stale source graph was selected");
    assert.match(stale.stderr, /VKF stage component artifact does not match its source graph/);
    assert.equal(stale.stdout, "");
    assert.equal(readFileSync(selected, "utf8"), "preserve-selected");
    assert.equal(readFileSync(provenance, "utf8"), "preserve-provenance");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("strict dispatcher rejects malformed arity and overlapping paths precisely", () => {
  const malformed = spawnSync(
    compiler,
    ["--vkf-internal-stage-component", componentName],
    { cwd: root, encoding: "utf8", timeout: 5_000, windowsHide: true },
  );
  assert.equal(malformed.error, undefined);
  assert.notEqual(malformed.status, 0);
  assert.match(
    malformed.stderr,
    /usage: vkf-strict --vkf-internal-stage-component name artifact source oracle-output selected-output provenance/,
  );
  assert.equal(malformed.stdout, "");

  const work = makeWork("i33d-path-");
  try {
    const { artifact, source } = compileComponent(work);
    const oracle = join(work, "oracle.txt");
    const provenance = join(work, "provenance.json");
    writeFileSync(oracle, `[1, 1, 2]${outputNewline}`, "utf8");

    const overlap = dispatch({
      artifact,
      oracle,
      provenance,
      selected: source,
      source,
    });
    assert.equal(overlap.error, undefined);
    assert.notEqual(overlap.status, 0);
    assert.match(overlap.stderr, /stage component output paths overlap protected inputs/);
    assert.equal(overlap.stdout, "");
    assert.equal(existsSync(provenance), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("strict dispatcher never partially publishes malformed output paths", () => {
  const work = makeWork("i33d-atomic-");
  try {
    const { artifact, source } = compileComponent(work);
    const oracle = join(work, "oracle.txt");
    const selected = join(work, "selected.txt");
    const provenance = join(work, "provenance-directory");
    writeFileSync(oracle, `[1, 1, 2]${outputNewline}`, "utf8");
    writeFileSync(selected, "preserve-selected", "utf8");
    mkdirSync(provenance);

    const rejected = dispatch({ artifact, oracle, provenance, selected, source });
    assert.equal(rejected.error, undefined);
    assert.notEqual(rejected.status, 0, "directory output path was accepted");
    assert.match(rejected.stderr, /stage component output path is not a regular file/);
    assert.equal(rejected.stdout, "");
    assert.equal(readFileSync(selected, "utf8"), "preserve-selected");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
