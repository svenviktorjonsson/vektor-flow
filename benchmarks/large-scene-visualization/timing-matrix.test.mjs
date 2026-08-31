import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applicableLaneSpecs,
  buildTimingEvidence,
} from './timing-matrix.mjs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

const environment = Object.freeze({
  operatingSystem: 'Windows_NT 10.0.26200',
  architecture: 'x64',
  cpu: 'test cpu',
  browser: 'Microsoft Edge',
  browserVersion: '152.0.0.0',
  browserUserAgent: 'Edg/152.0.0.0',
  gpu: 'Google; ANGLE NVIDIA',
  webglVendor: 'Google',
  webglRenderer: 'ANGLE NVIDIA',
  devicePixelRatio: 1,
  viewport: [1280, 720],
  powerMode: 'not-recorded',
});

function lane(spec, milliseconds, options = {}) {
  const workload = manifest.workloads.find(({ id }) => id === spec.workload);
  const checkpointCount = workload.correctness.checkpoints.length;
  return {
    ...spec,
    passed: options.passed ?? true,
    exitCode: 0,
    result: {
      ok: true,
      adapterVersion: 'test',
      environment: options.environment ?? environment,
      clock: options.clock ?? {
        crossOriginIsolated: true,
        minimumPositiveDeltaMs: 0.005,
        reads: 100_000,
        positiveReads: 10_000,
      },
      correctness: {
        passed: true,
        completedAtSequence: 1,
        checkpoints: workload.correctness.checkpoints.map((frame) => ({
          frame,
          passed: true,
          maxRegionError: 0.01,
          artifactSha256: 'a'.repeat(64),
        })),
        retained: { sourceIdentityRetained: true, largeBufferUploadsAfterInitialize: 0 },
        gpuCompletionCalls: checkpointCount,
      },
      timing: milliseconds === null ? null : {
        startedAtSequence: 2,
        warmupFrames: 60,
        measuredFrames: 120,
        samplesMs: Array(120).fill(milliseconds),
        measuredGpuFrames: 120,
        gpuCompletionCalls: checkpointCount + 60 + 120,
      },
    },
  };
}

test('rotates and selects exactly the seven workload-applicable lanes', () => {
  assert.deepEqual(applicableLaneSpecs(manifest), [
    { implementation: 'vkf', workload: 'orthographic-points-100k-static' },
    { implementation: 'deck-gl', workload: 'orthographic-points-100k-static' },
    { implementation: 'vtk-js', workload: 'orthographic-points-100k-static' },
    { implementation: 'plotly-scattergl', workload: 'orthographic-points-100k-static' },
    { implementation: 'deck-gl', workload: 'orthographic-points-1m-pan' },
    { implementation: 'vtk-js', workload: 'orthographic-points-1m-pan' },
    { implementation: 'vkf', workload: 'orthographic-points-1m-pan' },
  ]);
});

test('publishes only after global preflight, exact environment, 60 warmups, and 120 samples', () => {
  const specs = applicableLaneSpecs(manifest);
  const preflight = specs.map((spec) => lane(spec, null));
  const timing = specs.map((spec) => lane(spec, spec.implementation === 'vkf' ? 1 : 2));
  const evidence = buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  });
  assert.equal(evidence.status, 'measured');
  assert.equal(evidence.performanceClaim, true);
  assert.equal(evidence.publishedReport.workloads.length, 2);
  assert.deepEqual(evidence.ratchet.rows.map(({ ratio }) => ratio), [0.5, 0.5, 0.5, 0.5, 0.5]);

  const tooFew = structuredClone(timing);
  tooFew[0].result.timing.samplesMs.length = 119;
  assert.throws(() => buildTimingEvidence(manifest, {
    preflight,
    timing: tooFew,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  }), /120 measured frames/);
});

test('rejects over-counted work that claims the exact 60/120 protocol', () => {
  const specs = applicableLaneSpecs(manifest);
  const preflight = specs.map((spec) => lane(spec, null));
  const timing = specs.map((spec) => lane(spec, 1));
  const build = () => buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  });

  preflight[0].result.correctness.gpuCompletionCalls += 1;
  assert.throws(build, /correctness GPU completions/);
  preflight[0].result.correctness.gpuCompletionCalls -= 1;

  timing[0].result.timing.samplesMs.push(1);
  timing[0].result.timing.measuredGpuFrames += 1;
  timing[0].result.timing.measuredFrames += 1;
  timing[0].result.timing.gpuCompletionCalls += 1;
  assert.throws(build, /exactly 120 measured samples/);
  timing[0] = lane(specs[0], 1);

  timing[0].result.timing.warmupFrames += 1;
  timing[0].result.timing.gpuCompletionCalls += 1;
  assert.throws(build, /exactly 60 warmup frames/);
  timing[0] = lane(specs[0], 1);

  timing[0].result.timing.gpuCompletionCalls += 1;
  assert.throws(build, /exactly 183 GPU completions/);
});

test('withholds publication while preserving raw samples when a ratio fails', () => {
  const specs = applicableLaneSpecs(manifest);
  const preflight = specs.map((spec) => lane(spec, null));
  const timing = specs.map((spec) => lane(spec, spec.implementation === 'vkf' ? 3 : 1));
  const evidence = buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  });
  assert.equal(evidence.status, 'withheld-ratchet-failed');
  assert.equal(evidence.performanceClaim, false);
  assert.equal(evidence.publishedReport, undefined);
  assert.equal(evidence.rawTimingLanes.length, 7);
  assert.match(evidence.ratchetError, /ratio 3\.000 must be below 1\.500/);
});

test('never starts publication from incomplete preflight or mixed GPU evidence', () => {
  const specs = applicableLaneSpecs(manifest);
  const preflight = specs.map((spec) => lane(spec, null));
  const timing = specs.map((spec) => lane(spec, 1));
  preflight[2].passed = false;
  assert.throws(() => buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  }), /global correctness preflight/);

  preflight[2].passed = true;
  timing[3].result.environment = { ...environment, webglRenderer: 'different GPU' };
  assert.throws(() => buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  }), /same browser and GPU/);
});

test('withholds publication for software fallback or adaptively batched frame samples', () => {
  const specs = applicableLaneSpecs(manifest);
  const preflight = specs.map((spec) => lane(spec, null));
  const timing = specs.map((spec) => lane(spec, 1));
  timing[0].result.timing.measuredGpuFrames = 240;
  assert.throws(() => buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  }), /exactly one completed GPU frame per timing sample/);

  const software = { ...environment, gpu: 'Google; ANGLE SwiftShader', webglRenderer: 'ANGLE SwiftShader' };
  for (const item of [...preflight, ...timing]) item.result.environment = software;
  timing[0].result.timing.measuredGpuFrames = 120;
  assert.throws(() => buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment: software,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  }), /hardware renderer/);

  for (const item of [...preflight, ...timing]) {
    item.result.environment = environment;
    item.result.clock = { ...item.result.clock, crossOriginIsolated: false, minimumPositiveDeltaMs: 0.1 };
  }
  assert.throws(() => buildTimingEvidence(manifest, {
    preflight,
    timing,
    environment,
    versions: {},
    sourceCommit: 'b'.repeat(40),
  }), /high-resolution clock evidence/);
});
