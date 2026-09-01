import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validateSuiteMatrix } from "../benchmarks/retained-cloud-indicator/suite-contract.mjs";

const LARGE_SCENE_PATH = "docs/evidence/artifacts/040-g09-large-scene-peer-timing.json";
const RETAINED_CLOUD_PATH = "docs/evidence/artifacts/040-retained-cloud-indicator.json";

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function verifyLargeScene(evidence) {
  assert.equal(evidence.schema, "vkf.large-scene-peer-timing-evidence");
  assert.equal(evidence.versions.vkf, "0.4.0");
  assert.equal(evidence.status, "measured");
  assert.equal(evidence.performanceClaim, true);
  assert.equal(evidence.warmupFrames, 60);
  assert.equal(evidence.measuredFrames, 120);
  assert.equal(evidence.rawPreflightLanes.length, 7);
  assert.equal(evidence.rawTimingLanes.length, 7);
  assert.ok(evidence.rawPreflightLanes.every((lane) => lane.passed && lane.result?.ok));
  assert.ok(evidence.rawTimingLanes.every((lane) => lane.passed && lane.result?.ok));

  const relativeLimit = evidence.ratchet.gate.maxVkfToPeerRatioExclusive;
  assert.equal(relativeLimit, 1.5);
  assert.equal(evidence.ratchet.hasPublishedClaims, true);
  assert.equal(evidence.ratchet.rows.length, 5);
  assert.ok(evidence.ratchet.rows.every(({ ratio }) => ratio < relativeLimit));

  return {
    correctnessLanes: evidence.rawPreflightLanes.length,
    timingLanes: evidence.rawTimingLanes.length,
    comparableRows: evidence.ratchet.rows.length,
    relativeLimit,
    performanceClaim: evidence.performanceClaim,
  };
}

async function verifyCapture(root, artifact) {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(root, artifact.path);
  assert.ok(
    absolutePath.startsWith(`${absoluteRoot}${path.sep}`),
    `capture leaves repository: ${artifact.path}`,
  );
  const bytes = await readFile(absolutePath);
  assert.equal((await stat(absolutePath)).size, artifact.bytes, artifact.path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, artifact.path);
}

async function verifyRetainedCloud(root, evidence) {
  assert.equal(evidence.schema, "vkf.retained-cloud-indicator-evidence");
  assert.equal(evidence.packageVersion, "0.4.0");
  assert.equal(evidence.protocol.pointCount, 1_000_000);
  assert.deepEqual(evidence.protocol.pointSizesPx, [1, 4]);
  assert.equal(evidence.rows.length, 8);
  assert.equal(validateSuiteMatrix(evidence.rows, evidence.environmentKey), true);
  assert.equal("ratchet" in evidence, false);
  assert.equal("performanceClaim" in evidence, false);

  let correctnessPassedRows = 0;
  let correctnessUnsupportedRows = 0;
  const captures = new Map();
  for (const row of evidence.rows) {
    assert.equal(row.runs.length, 3);
    const passed = row.runs.every(({ result }) => result.correctness.passed);
    const unsupported = row.runs.every(({ result }) => (
      !result.correctness.passed
      && result.correctness.disposition === "correctness-unsupported-no-timing"
      && result.timing === null
    ));
    assert.ok(passed || unsupported, `${row.implementation}/${row.pointSizePx}px has mixed validity`);
    if (passed) correctnessPassedRows += 1;
    if (unsupported) correctnessUnsupportedRows += 1;

    for (const { result } of row.runs) {
      const retention = result.timing?.retainedAfterTiming ?? result.retainedAtCorrectnessGate;
      assert.equal(retention.fixtureBufferWritesAfterInitialize, 0);
      assert.equal(retention.fixtureBufferReallocationsAfterInitialize, 0);
      for (const capture of result.correctness.captures) {
        if (capture.artifactPng) captures.set(capture.artifactPng.path, capture.artifactPng);
      }
    }
  }
  assert.equal(correctnessPassedRows, 6);
  assert.equal(correctnessUnsupportedRows, 2);
  assert.equal(captures.size, 40);
  await Promise.all([...captures.values()].map((artifact) => verifyCapture(root, artifact)));

  return {
    rows: evidence.rows.length,
    repeatedRuns: evidence.rows.reduce((count, row) => count + row.runs.length, 0),
    correctnessPassedRows,
    correctnessUnsupportedRows,
    captureArtifacts: captures.size,
    performanceRatchet: false,
  };
}

export async function verifyReleaseEvidence(root = process.cwd()) {
  const [largeSceneEvidence, retainedCloudEvidence] = await Promise.all([
    readJson(root, LARGE_SCENE_PATH),
    readJson(root, RETAINED_CLOUD_PATH),
  ]);
  return {
    largeScene: verifyLargeScene(largeSceneEvidence),
    retainedCloud: await verifyRetainedCloud(root, retainedCloudEvidence),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyReleaseEvidence(), null, 2));
}
