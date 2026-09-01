import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { verifyReleaseEvidence } from "../../tools/verify-040-release-evidence.mjs";

test("0.4 publication evidence keeps the ratcheted and indicator contracts distinct", async () => {
  const result = await verifyReleaseEvidence(process.cwd());

  assert.deepEqual(result.largeScene, {
    correctnessLanes: 7,
    timingLanes: 7,
    comparableRows: 5,
    relativeLimit: 1.5,
    performanceClaim: true,
  });
  assert.deepEqual(result.retainedCloud, {
    rows: 8,
    repeatedRuns: 24,
    correctnessPassedRows: 6,
    correctnessUnsupportedRows: 2,
    captureArtifacts: 40,
    performanceRatchet: false,
  });
});

test("native release uploads verified visual evidence before publication", () => {
  const workflow = readFileSync(".github/workflows/native-release.yml", "utf8");

  assert.match(workflow, /^  visual-evidence:\s*$/m);
  assert.match(workflow, /node tools\/verify-040-release-evidence\.mjs/);
  assert.match(workflow, /name: windows-x64-visual-evidence-proof/);
  assert.match(workflow, /040-g09-large-scene-peer-timing\.json/);
  assert.match(workflow, /040-retained-cloud-indicator-captures\//);
  assert.match(workflow, /publish:[\s\S]*?needs:[\s\S]*?- visual-evidence/);
});
