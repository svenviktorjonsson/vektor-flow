import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  evaluateReport,
  sha256Json,
  validateManifest,
  workloadContractSha256,
} from './contract.mjs';
import { generatePointFixture } from './materialize-fixtures.mjs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

function testManifest(workloadIndex = 0) {
  const copy = structuredClone(manifest);
  copy.measurement.minimumMeasuredFrames = 3;
  copy.workloads = [structuredClone(copy.workloads[workloadIndex])];
  copy.workloads[0].pointCount = 16;
  copy.workloads[0].fixture.sha256 = createHash('sha256')
    .update(generatePointFixture(copy.workloads[0].fixture, 16))
    .digest('hex');
  return copy;
}

function environment() {
  return {
    operatingSystem: 'test-os',
    architecture: 'x64',
    cpu: 'test-cpu',
    gpu: 'test-gpu',
    browser: 'test-browser',
    browserVersion: '1.0.0',
    devicePixelRatio: 1,
    viewport: [1280, 720],
    powerMode: 'ac-stable',
  };
}

function publishedMeasurement(activeManifest, implementation, samplesMs, options = {}) {
  const workload = activeManifest.workloads[0];
  return {
    implementation,
    state: 'published',
    comparable: true,
    versions: options.versions ?? { implementation: 'test', harness: 'test' },
    correctness: {
      passed: options.correctnessPassed ?? true,
      completedAtSequence: 1,
      oracle: workload.correctness.oracle,
      artifactSha256: 'a'.repeat(64),
      datasetSha256: workload.fixture.sha256,
      workloadContractSha256: workloadContractSha256(workload),
      maxRegionError: 0.01,
      allowedRegionError: workload.correctness.maxRegionError,
    },
    timing: {
      startedAtSequence: options.startedAtSequence ?? 2,
      metric: activeManifest.measurement.ratchetMetric,
      samplesMs,
    },
  };
}

function report(activeManifest, measurements) {
  return {
    schema: 'vkf.large-scene-visualization-report',
    schemaVersion: 1,
    manifestSha256: sha256Json(activeManifest),
    status: measurements.some((entry) => entry.state === 'published') ? 'measured' : 'scaffold',
    environment: environment(),
    workloads: [{ id: activeManifest.workloads[0].id, measurements }],
  };
}

test('pins equivalent large point workloads and current peer adapter contracts', () => {
  assert.equal(validateManifest(manifest), true);
  assert.deepEqual(manifest.peers.map(({ id }) => id), [
    'deck-gl',
    'vtk-js',
    'plotly-scattergl',
  ]);
  assert.deepEqual(manifest.workloads.map(({ pointCount }) => pointCount), [100_000, 1_000_000]);
  assert.deepEqual(manifest.workloads.map(({ comparableImplementations }) => comparableImplementations), [
    ['vkf', 'deck-gl', 'vtk-js', 'plotly-scattergl'],
    ['vkf', 'deck-gl', 'vtk-js'],
  ]);
  for (const workload of manifest.workloads) {
    assert.deepEqual(workload.viewport, [1280, 720]);
    assert.equal(workload.devicePixelRatio, 1);
    assert.equal(workload.primitive, 'screen-space circular point');
    assert.equal(workload.projection, 'orthographic');
    assert.equal(workload.dataMutation, 'none');
    assert.equal(workload.correctness.reference, 'ideal-disc-source-over-v1');
    assert.equal(workload.correctness.subpixelsPerAxis, 8);
  }
  assert.equal(manifest.workloads[1].perFrameOperation, 'camera-only pan; position buffers remain unchanged');
  assert.equal(
    manifest.workloads[1].cameraPath.formula,
    'phase=2*pi*frame/frames; offset=[xAmplitude*sin(phase),yAmplitude*cos(phase)]',
  );
  assert.match(manifest.peers.find(({ id }) => id === 'vtk-js').adapterContract, /SphereMapper/);
  assert.equal(manifest.measurement.minimumMeasuredFrames, 120);
  assert.deepEqual(manifest.releaseGates['0.4.0'], {
    status: 'active',
    maxVkfToPeerRatioExclusive: 1.5,
  });
  assert.deepEqual(manifest.releaseGates['0.6.0'], {
    status: 'deferred',
    maxVkfToPeerRatioExclusive: 0.5,
  });
});

test('fixture generation is byte-stable and manifest hashes pin every dataset', () => {
  for (const workload of manifest.workloads) {
    const first = generatePointFixture(workload.fixture, workload.pointCount);
    const second = generatePointFixture(workload.fixture, workload.pointCount);
    assert.equal(first.equals(second), true);
    assert.equal(first.byteLength, workload.pointCount * 2 * 4);
    assert.equal(createHash('sha256').update(first).digest('hex'), workload.fixture.sha256);
  }
});

test('0.4 ratchet accepts every correctness-gated comparable row strictly below 1.5x', () => {
  const activeManifest = testManifest();
  const result = evaluateReport(activeManifest, report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [14.99, 14.99, 14.99]),
    publishedMeasurement(activeManifest, 'deck-gl', [10, 10, 10]),
    publishedMeasurement(activeManifest, 'vtk-js', [20, 20, 20]),
    publishedMeasurement(activeManifest, 'plotly-scattergl', [12, 12, 12]),
  ]));
  assert.equal(result.hasPublishedClaims, true);
  assert.deepEqual(result.rows.map(({ peer, ratio }) => [peer, ratio]), [
    ['deck-gl', 1.499],
    ['vtk-js', 0.7495],
    ['plotly-scattergl', 14.99 / 12],
  ]);
});

test('0.4 ratchet rejects equality and any slower published comparable row', () => {
  const activeManifest = testManifest();
  assert.throws(() => evaluateReport(activeManifest, report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [15, 15, 15]),
    publishedMeasurement(activeManifest, 'deck-gl', [20, 20, 20]),
    publishedMeasurement(activeManifest, 'vtk-js', [20, 20, 20]),
    publishedMeasurement(activeManifest, 'plotly-scattergl', [10, 10, 10]),
  ])), /plotly-scattergl ratio 1\.500.*below 1\.500/);
});

test('a VKF timing cannot be published without at least one comparable peer row', () => {
  const activeManifest = testManifest();
  assert.throws(() => evaluateReport(activeManifest, report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [8, 8, 8]),
  ])), /has VKF timing without a peer comparison/);
});

test('a 0.4 measured workload is withheld until every frozen peer row is valid', () => {
  const activeManifest = testManifest();
  assert.throws(() => evaluateReport(activeManifest, report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [8, 8, 8]),
    publishedMeasurement(activeManifest, 'deck-gl', [10, 10, 10]),
    publishedMeasurement(activeManifest, 'vtk-js', [12, 12, 12]),
    { implementation: 'plotly-scattergl', state: 'scaffold', comparable: true },
  ])), /must publish vkf, deck-gl, vtk-js, plotly-scattergl together/);
});

test('retained pan excludes Plotly relayout but still requires both comparable peers', () => {
  const activeManifest = testManifest(1);
  const measurements = [
    publishedMeasurement(activeManifest, 'vkf', [8, 8, 8]),
    publishedMeasurement(activeManifest, 'deck-gl', [10, 10, 10]),
    publishedMeasurement(activeManifest, 'vtk-js', [12, 12, 12]),
    {
      implementation: 'plotly-scattergl',
      state: 'not-applicable',
      comparable: false,
      reason: activeManifest.workloads[0].nonComparableImplementations[0].reason,
    },
  ];
  const result = evaluateReport(activeManifest, report(activeManifest, measurements));
  assert.deepEqual(result.rows.map(({ peer }) => peer), ['deck-gl', 'vtk-js']);

  assert.throws(() => evaluateReport(activeManifest, report(activeManifest, [
    measurements[0],
    measurements[1],
    measurements[3],
  ])), /must publish vkf, deck-gl, vtk-js together/);

  assert.throws(() => evaluateReport(activeManifest, report(activeManifest, [
    ...measurements.slice(0, 3),
    publishedMeasurement(activeManifest, 'plotly-scattergl', [11, 11, 11]),
  ])), /plotly-scattergl is not comparable for orthographic-points-1m-pan/);
});

test('published timing is rejected unless correctness completed first on the exact contract', () => {
  const activeManifest = testManifest();
  assert.throws(() => evaluateReport(activeManifest, report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [8, 8, 8], { correctnessPassed: false }),
    publishedMeasurement(activeManifest, 'deck-gl', [10, 10, 10]),
  ])), /vkf correctness did not pass/);
  assert.throws(() => evaluateReport(activeManifest, report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [8, 8, 8], { startedAtSequence: 1 }),
    publishedMeasurement(activeManifest, 'deck-gl', [10, 10, 10]),
  ])), /vkf timing started before correctness completed/);

  const changed = report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [8, 8, 8]),
    publishedMeasurement(activeManifest, 'deck-gl', [10, 10, 10]),
  ]);
  changed.workloads[0].measurements[1].correctness.datasetSha256 = 'b'.repeat(64);
  assert.throws(() => evaluateReport(activeManifest, changed), /deck-gl dataset hash/);
});

test('scaffold lanes carry no measurements and never become performance claims', () => {
  const activeManifest = testManifest();
  const scaffold = report(activeManifest, activeManifest.implementations.map((implementation) => ({
    implementation,
    state: 'scaffold',
    comparable: true,
  })));
  const result = evaluateReport(activeManifest, scaffold);
  assert.equal(result.hasPublishedClaims, false);
  assert.deepEqual(result.rows, []);
});

test('the deferred 0.6 target is recorded but not enforced by the 0.4 ratchet', () => {
  const activeManifest = testManifest();
  const result = evaluateReport(activeManifest, report(activeManifest, [
    publishedMeasurement(activeManifest, 'vkf', [7.5, 7.5, 7.5]),
    publishedMeasurement(activeManifest, 'deck-gl', [10, 10, 10]),
    publishedMeasurement(activeManifest, 'vtk-js', [11, 11, 11]),
    publishedMeasurement(activeManifest, 'plotly-scattergl', [12, 12, 12]),
  ]));
  assert.equal(result.gate.release, '0.4.0');
  assert.equal(result.gate.maxVkfToPeerRatioExclusive, 1.5);
  assert.equal(result.rows[0].ratio, 0.75);
});

test('checked-in harness scaffold is executable and explicitly makes no performance claim', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url))], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified 2 generated point fixtures/);
  assert.match(result.stdout, /scaffold only: 0 published comparisons; no performance claim/);
});
