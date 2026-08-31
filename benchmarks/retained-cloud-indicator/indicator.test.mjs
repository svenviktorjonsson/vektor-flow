import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDICATOR_PROTOCOL,
  createCloudFixture,
  fixtureSha256,
  orbitProjection,
} from './protocol.mjs';
import { summarizeIntervals } from './statistics.mjs';
import { runIndicatorLane } from './measurement.mjs';
import {
  createRetentionLedger,
  installWebGpuFixtureTracker,
} from './retention-ledger.mjs';

test('release indicator freezes one million aligned XYZ+RGBA8 points and two size lanes', async () => {
  assert.equal(INDICATOR_PROTOCOL.pointCount, 1_000_000);
  assert.deepEqual(INDICATOR_PROTOCOL.pointSizesPx, [1, 4]);
  assert.equal(INDICATOR_PROTOCOL.warmupFrames, 60);
  assert.equal(INDICATOR_PROTOCOL.measuredFrames, 100);
  assert.equal(INDICATOR_PROTOCOL.strideBytes, 16);
  const fixture = createCloudFixture(3);
  assert.equal(fixture.byteLength, 48);
  assert.equal(fixture.positions.length, 9);
  assert.equal(fixture.colors.length, 12);
  assert.equal(await fixtureSha256(fixture.bytes), 'f375405ad0613530d0411b0fa39bbed459414d4d50e6d7b696d77883b5603c6b');
});

test('deterministic orbit changes only projection uniforms', () => {
  const start = orbitProjection(0, [1280, 720]);
  const quarter = orbitProjection(25, [1280, 720]);
  assert.deepEqual(start.worldOrigin, quarter.worldOrigin);
  assert.deepEqual(start.screenOrigin, quarter.screenOrigin);
  assert.ok(start.xAxis[0] > 0);
  assert.ok(Math.abs(start.zAxis[0]) < 1e-12);
  assert.ok(Math.abs(quarter.xAxis[0]) < 1e-12);
  assert.ok(quarter.zAxis[0] > 0);
  assert.deepEqual(start.yAxis, quarter.yAxis);
});

test('frame summary uses sample deviation and reports visible pacing thresholds', () => {
  const summary = summarizeIntervals([10, 20, 40, 50]);
  assert.equal(summary.count, 4);
  assert.equal(summary.meanMs, 30);
  assert.ok(Math.abs(summary.sampleStddevMs - Math.sqrt(1000 / 3)) < 1e-12);
  assert.equal(summary.p50Ms, 30);
  assert.equal(summary.p95Ms, 48.5);
  assert.ok(Math.abs(summary.p99Ms - 49.7) < 1e-12);
  assert.equal(summary.maxMs, 50);
  assert.equal(summary.effectiveFps, 1000 / 30);
  assert.deepEqual(summary.missedFrames60Hz, { thresholdMs: 16.67, count: 3, rate: 0.75 });
  assert.deepEqual(summary.missedFrames30Hz, { thresholdMs: 33.33, count: 2, rate: 0.5 });
  assert.deepEqual(summary.rawSamplesMs, [10, 20, 40, 50]);
});

test('lane separates rAF pacing, GPU timestamps, and serialized completion latency', async () => {
  const calls = [];
  let completions = 0;
  let submissions = 0;
  const adapter = {
    id: 'fake',
    version: '1.0.0',
    async initialize() { calls.push('initialize'); return { firstVisibleMs: 5, uploadBytes: 16 }; },
    async submitFrame(frame) { calls.push(`submit:${frame}`); submissions += 1; },
    async completeGpu() { calls.push('complete'); completions += 1; return null; },
    async drainGpu() { calls.push('drain'); },
    async capture(frame) { calls.push(`capture:${frame}`); return { passed: true, frame, hash: 'a'.repeat(64) }; },
    retainedEvidence() {
      return {
        fixtureBufferWritesAfterInitialize: 0,
        fixtureBufferReallocationsAfterInitialize: 0,
        cameraUniformWritesAfterInitialize: submissions,
      };
    },
    async destroy() { calls.push('destroy'); },
  };
  let clock = 0;
  let animationTimestamp = 0;
  const result = await runIndicatorLane(adapter, { pointSizePx: 4 }, {
    now: () => ++clock,
    nextAnimationFrame: async () => { animationTimestamp += 10; return animationTimestamp; },
  });
  assert.equal(result.correctness.passed, true);
  assert.equal(result.timing.presentation.warmupFrames, 60);
  assert.equal(result.timing.presentation.measuredFrames, 100);
  assert.equal(result.timing.gpuCompletionCalls, 161);
  assert.equal(result.timing.finalDrainCalls, 2);
  assert.equal(result.timing.presentation.presentedIntervals.rawSamplesMs.length, 100);
  assert.equal(result.timing.presentation.cpuSubmit.rawSamplesMs.length, 100);
  assert.equal(result.timing.gpuTimestamp, null);
  assert.equal(result.timing.serializedSubmitToCompletion.rawSamplesMs.length, 100);
  assert.equal(completions, 161);
  assert.equal(submissions, 321);
  assert.ok(calls.indexOf('capture:0') < calls.indexOf('submit:1'));
  assert.equal(calls.at(-1), 'destroy');
});

test('lane rejects fixture writes while permitting bounded camera-uniform writes', async () => {
  let submissions = 0;
  const adapter = {
    id: 'fake', version: '1.0.0',
    async initialize() {},
    async submitFrame() { submissions += 1; },
    async completeGpu() {},
    async drainGpu() {},
    async capture() { return { passed: true, hash: 'b'.repeat(64) }; },
    retainedEvidence() {
      return {
        fixtureBufferWritesAfterInitialize: 1,
        fixtureBufferReallocationsAfterInitialize: 0,
        cameraUniformWritesAfterInitialize: submissions,
      };
    },
    async destroy() {},
  };
  await assert.rejects(runIndicatorLane(adapter, { pointSizePx: 1 }), /fixture buffer write/);
  assert.equal(submissions, 1);
});

test('retention ledger separates fixture mutation from bounded camera uniforms', () => {
  const ledger = createRetentionLedger();
  ledger.recordFixtureUpload(16_000_000, true);
  ledger.markInitialized();
  ledger.recordCameraUniformWrite(48);
  assert.deepEqual(ledger.evidence(), {
    initialFixtureBufferWrites: 1,
    initialFixtureBufferBytes: 16_000_000,
    initialFixtureBufferAllocations: 1,
    fixtureBufferWritesAfterInitialize: 0,
    fixtureBufferBytesAfterInitialize: 0,
    fixtureBufferReallocationsAfterInitialize: 0,
    cameraUniformWritesAfterInitialize: 1,
    cameraUniformBytesAfterInitialize: 48,
  });
  ledger.recordFixtureUpload(16_000_000, false);
  assert.equal(ledger.evidence().fixtureBufferWritesAfterInitialize, 1);
});

test('WebGPU tracker rejects writes and reallocations of registered fixture buffers', () => {
  class FakeQueue {
    writeBuffer(buffer, _offset, source) { return source.byteLength; }
  }
  class FakeDevice {
    createBuffer(descriptor) { return { size: descriptor.size }; }
  }
  const tracker = installWebGpuFixtureTracker(1024, {
    GPUQueue: FakeQueue,
    GPUDevice: FakeDevice,
  });
  const device = new FakeDevice();
  const queue = new FakeQueue();
  const fixtureBuffer = device.createBuffer({ size: 4096 });
  queue.writeBuffer(fixtureBuffer, 0, new Uint8Array(4096));
  tracker.registerFixtureBuffer(fixtureBuffer);
  tracker.markInitialized();
  queue.writeBuffer({ size: 256 }, 0, new Uint8Array(48));
  assert.equal(tracker.evidence().fixtureBufferWritesAfterInitialize, 0);
  queue.writeBuffer(fixtureBuffer, 0, new Uint8Array(4096));
  device.createBuffer({ size: 4096 });
  assert.equal(tracker.evidence().fixtureBufferWritesAfterInitialize, 1);
  assert.equal(tracker.evidence().fixtureBufferReallocationsAfterInitialize, 1);
  tracker.restore();
});
