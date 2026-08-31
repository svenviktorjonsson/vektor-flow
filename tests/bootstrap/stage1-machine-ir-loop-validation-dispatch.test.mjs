import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const component = "machine_ir.numeric_count_to_loop.stack_validation";
const outputNewline = process.platform === "win32" ? "\r\n" : "\n";

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
  const source = join(work, "loop-validator.vkf");
  const artifact = join(work, `loop-validator${executableSuffix}`);
  writeFileSync(
    source,
    [
      "validation: .machine_ir_validation",
      ':: validation.machine_ir_numeric_count_to_loop_stack_maxima("count_to", "limit", "value", 3)',
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

function dispatch({ artifact, oracle, provenance, selected, source }) {
  return spawnSync(
    compiler,
    [
      "--vkf-internal-stage-component",
      component,
      artifact,
      source,
      oracle,
      selected,
      provenance,
    ],
    { cwd: root, encoding: "utf8", timeout: 5_000, windowsHide: true },
  );
}

test("strict Stage dispatch selects the source-owned fixed-loop stack validator", () => {
  const work = makeWork("i58-loop-dispatch-");
  try {
    const { artifact, source } = compileComponent(work);
    const oracle = join(work, "oracle.txt");
    const selected = join(work, "selected.txt");
    const provenance = join(work, "provenance.json");
    writeFileSync(oracle, `[1, 2]${outputNewline}`, "utf8");

    const first = dispatch({ artifact, oracle, provenance, selected, source });
    assert.equal(first.error, undefined, `dispatcher did not start: ${first.error}`);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), {
      component,
      implementation: "vkf_source",
      provenance_path: resolve(provenance),
      selected_output_path: resolve(selected),
      status: "selected",
    });

    const selectedBytes = readFileSync(selected);
    const provenanceBytes = readFileSync(provenance);
    const sourceBytes = readFileSync(source);
    const artifactBytes = readFileSync(artifact);
    const sourceGraphMarker = artifactBytes.toString("latin1").match(/VKF-CACHE-V1:([0-9a-f]{64})/);
    assert.ok(sourceGraphMarker, "compiled validator has no source-graph fingerprint");
    assert.equal(selectedBytes.toString("utf8"), `[1, 2]${outputNewline}`);
    assert.deepEqual(JSON.parse(provenanceBytes), {
      component,
      component_artifact: resolve(artifact),
      component_artifact_sha256: sha256(artifactBytes),
      component_source: resolve(source),
      component_source_graph_fingerprint: sourceGraphMarker[1],
      component_source_sha256: sha256(sourceBytes),
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
