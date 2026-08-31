import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertComparableAdapter,
  runCorrectnessThenTiming,
} from './peer-measurement.mjs';

function workload() {
  return {
    id: 'test-pan',
    pointCount: 4,
    fixture: { sha256: 'a'.repeat(64) },
    cameraPath: { frames: 4 },
    correctness: { checkpoints: [0, 2], maxRegionError: 0.08 },
  };
}

function fakeAdapter(options = {}) {
  const calls = [];
  let completion = 0;
  return {
    calls,
    version: 'test-1.0',
    async initialize() { calls.push('initialize'); },
    async renderFrame(frame) { calls.push(`render:${frame}`); },
    async completeGpu() { completion += 1; calls.push('complete'); return completion; },
    async capture(frame) {
      calls.push(`capture:${frame}`);
      return { passed: options.failFrame !== frame, maxRegionError: options.failFrame === frame ? 0.2 : 0.01 };
    },
    retainedEvidence() {
      return { sourceIdentityRetained: true, largeBufferUploadsAfterInitialize: options.lateUploads ?? 0 };
    },
    destroy() { calls.push('destroy'); },
  };
}

test('peer adapters expose explicit GPU completion and retained-data evidence', () => {
  assert.throws(() => assertComparableAdapter({ initialize() {}, renderFrame() {} }), /completeGpu/);
  assert.equal(assertComparableAdapter(fakeAdapter()), true);
});

test('correctness checkpoints and GPU completion finish before timing begins', async () => {
  const adapter = fakeAdapter();
  const result = await runCorrectnessThenTiming(adapter, workload(), {
    warmupFrames: 2,
    measuredFrames: 3,
    now: (() => { let value = 0; return () => ++value; })(),
  });
  assert.equal(result.correctness.passed, true);
  assert.equal(result.correctness.completedAtSequence < result.timing.startedAtSequence, true);
  assert.equal(result.correctness.gpuCompletionCalls, 2);
  assert.equal(result.timing.gpuCompletionCalls, 7);
  assert.equal(result.timing.samplesMs.length, 3);
  assert.equal(adapter.calls.filter((call) => call === 'complete').length, 7);
  assert.equal(adapter.calls.at(-1), 'destroy');
});

test('failed correctness or a late large point upload withholds all timing', async () => {
  const failed = fakeAdapter({ failFrame: 2 });
  await assert.rejects(
    runCorrectnessThenTiming(failed, workload(), { warmupFrames: 1, measuredFrames: 1 }),
    /correctness failed at frame 2/,
  );
  assert.equal(failed.calls.some((call) => call.startsWith('render:3')), false);

  const reuploaded = fakeAdapter({ lateUploads: 1 });
  await assert.rejects(
    runCorrectnessThenTiming(reuploaded, workload(), { warmupFrames: 1, measuredFrames: 1 }),
    /large point buffer upload after initialization/,
  );
  assert.equal(reuploaded.calls.filter((call) => call.startsWith('render:')).length, 2);
});

test('matrix correctness phase completes and destroys without starting warmup or timing', async () => {
  const adapter = fakeAdapter();
  const result = await runCorrectnessThenTiming(adapter, workload(), {
    correctnessOnly: true,
    warmupFrames: 2,
    measuredFrames: 3,
  });
  assert.equal(result.correctness.passed, true);
  assert.equal(result.timing, null);
  assert.deepEqual(adapter.calls.filter((call) => call.startsWith('render:')), ['render:0', 'render:2']);
  assert.equal(adapter.calls.at(-1), 'destroy');
});
