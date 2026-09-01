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
  installWebGlFixtureTracker,
  installWebGpuFixtureTracker,
} from './retention-ledger.mjs';
import {
  assessCloudCapture,
  cloudReferenceRegionStats,
  compareCloudRegionStats,
} from './correctness.mjs';
import {
  bgraRowsToRgba,
  createVkfFlatOpaqueMarkerPipeline,
  createVkfMarkerScene,
  updateVkfOrbit,
  vkfMarkerInstances,
} from './adapters/vkf-marker-impostor.mjs';
import { rawOrbitUniform, rawPrimitiveForPointSize } from './adapters/raw-webgpu.mjs';
import { threeOrbitPosition, threePrimitiveForPointSize } from './adapters/three.mjs';
import { deckOrbitViewState, deckPrimitiveForPointSize } from './adapters/deck-gl.mjs';
import {
  SUITE_IMPLEMENTATIONS,
  SUITE_REPEATS,
  aggregateRunMeans,
  validateSuiteMatrix,
} from './suite-contract.mjs';

test('release indicator freezes one million aligned XYZ+RGBA8 points and two size lanes', async () => {
  assert.equal(INDICATOR_PROTOCOL.pointCount, 1_000_000);
  assert.deepEqual(INDICATOR_PROTOCOL.pointSizesPx, [1, 4]);
  assert.equal(INDICATOR_PROTOCOL.warmupFrames, 60);
  assert.equal(INDICATOR_PROTOCOL.measuredFrames, 100);
  assert.equal(INDICATOR_PROTOCOL.strideBytes, 16);
  assert.equal(INDICATOR_PROTOCOL.fixtureSha256, '469116dd54fbf3bcf2a061cbbd81a27bbb9d17c5bc0d1f2804fc70d4ce5a9104');
  assert.deepEqual(INDICATOR_PROTOCOL.correctnessFrames, [0, 25, 50, 75, 100]);
  assert.deepEqual(INDICATOR_PROTOCOL.renderState, {
    framebuffer: [1280, 720],
    devicePixelRatio: 1,
    primitive: '1px discrete point; 4px analytic circular point impostor',
    depthCompare: 'less',
    depthWrite: true,
    blend: 'premultiplied-alpha source-over',
    sampleCount: 4,
    canvasColorSpace: 'srgb',
    backgroundRgba: [0, 0, 0, 255],
    clipDepth: 'WebGPU 0..1',
    orthographicHalfHeight: 1.1,
  });
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
  assert.ok(quarter.zAxis[0] < 0);
  assert.deepEqual(start.yAxis, quarter.yAxis);
});

test('VKF texture readback removes row padding and converts BGRA to RGBA', () => {
  const padded = new Uint8Array(16);
  padded.set([3, 2, 1, 4, 7, 6, 5, 8], 0);
  padded.set([11, 10, 9, 12, 15, 14, 13, 16], 8);
  assert.deepEqual(
    bgraRowsToRgba(padded, 2, 2, 8),
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
  );
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
  assert.equal(summary.percentileMethod, 'R-7 linear interpolation');
  assert.deepEqual(summary.longestStall, { sampleIndex: 3, milliseconds: 50 });
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
    async submitFrame(frame) {
      calls.push(`submit:${frame}`);
      submissions += 1;
      return { cameraAngleRadians: 2 * Math.PI * frame / 100 };
    },
    async completeGpu() { calls.push('complete'); completions += 1; return null; },
    async drainGpu() { calls.push('drain'); },
    async capture(frame) { calls.push(`capture:${frame}`); return { frame }; },
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
    verifyCapture: async (_capture, frame) => {
      const closedFrame = frame === 100 ? 0 : frame;
      return {
        passed: true,
        artifactSha256: closedFrame.toString(16).padStart(64, '0'),
        observed: {
          grid: [1, 1], channels: ['coverage', 'r', 'g', 'b'],
          regions: [[closedFrame / 100, 0, 0, 0]],
        },
      };
    },
  });
  assert.equal(result.correctness.passed, true);
  assert.equal(result.timing.rafCallbackScheduling.warmupFrames, 60);
  assert.equal(result.timing.rafCallbackScheduling.measuredFrames, 100);
  assert.equal(result.timing.gpuCompletionCalls, 165);
  assert.equal(result.timing.finalDrainCalls, 2);
  assert.equal(result.timing.rafCallbackScheduling.rafCallbackIntervals.rawSamplesMs.length, 100);
  assert.equal(result.timing.rafCallbackScheduling.cpuSubmit.rawSamplesMs.length, 100);
  assert.equal(result.timing.gpuTimestamp, null);
  assert.equal(result.timing.serializedSubmitToCompletion.rawSamplesMs.length, 100);
  assert.equal(completions, 165);
  assert.equal(submissions, 325);
  assert.ok(calls.indexOf('capture:0') < calls.indexOf('submit:1'));
  assert.equal(calls.at(-1), 'destroy');
});

test('correctness-unsupported lane preserves all captures and never enters timing', async () => {
  let submissions = 0;
  const adapter = {
    id: 'vkf-marker-impostor', version: '0.4.0',
    async initialize() { return { firstVisibleMs: 5, uploadBytes: 32_000_000 }; },
    async submitFrame(frame) {
      submissions += 1;
      return { cameraAngleRadians: 2 * Math.PI * frame / 100 };
    },
    async completeGpu() {}, async drainGpu() {},
    async capture(frame) { return { frame }; },
    retainedEvidence() {
      return {
        fixtureBufferWritesAfterInitialize: 0,
        fixtureBufferReallocationsAfterInitialize: 0,
        cameraUniformWritesAfterInitialize: submissions,
      };
    },
    async destroy() {},
  };
  const result = await runIndicatorLane(adapter, { pointSizePx: 1 }, {
    allowCorrectnessUnsupported: true,
    encodeCaptureArtifact: async (_capture, frame) => `png:${frame}`,
    verifyCapture: async (_capture, frame) => {
      const closedFrame = frame === 100 ? 0 : frame;
      return {
        passed: frame !== 50,
        artifactSha256: closedFrame.toString(16).padStart(64, '0'),
        maxRegionError: frame === 50 ? 0.15860784313723514 : 0.1,
        observed: {
          grid: [1, 1], channels: ['coverage', 'r', 'g', 'b'],
          regions: [[closedFrame / 100, 0, 0, 0]],
        },
      };
    },
  });
  assert.equal(result.correctness.passed, false);
  assert.equal(result.correctness.disposition, 'correctness-unsupported-no-timing');
  assert.deepEqual(result.correctness.failedFrames, [50]);
  assert.equal(result.correctness.captures.length, 5);
  assert.equal(result.correctness.captures[2].artifactPngDataUrl, 'png:50');
  assert.equal(result.timing, null);
  assert.equal(result.retainedAtCorrectnessGate.fixtureBufferWritesAfterInitialize, 0);
  assert.equal(submissions, 5);
});

test('release lane rejects any fixture other than the frozen full-million bytes', async () => {
  const adapter = {
    id: 'must-not-start', version: '1.0.0',
    async initialize() { throw new Error('release validation ran too late'); },
    async submitFrame() {}, async completeGpu() {}, async drainGpu() {},
    async capture() {}, retainedEvidence() { return {}; }, async destroy() {},
  };
  await assert.rejects(runIndicatorLane(adapter, { pointSizePx: 4 }, {
    fixture: createCloudFixture(10),
    release: true,
  }), /frozen one-million fixture/);
});

test('lane rejects fixture writes while permitting bounded camera-uniform writes', async () => {
  let submissions = 0;
  const adapter = {
    id: 'fake', version: '1.0.0',
    async initialize() {},
    async submitFrame(frame) {
      submissions += 1;
      return { cameraAngleRadians: 2 * Math.PI * frame / 100 };
    },
    async completeGpu() {},
    async drainGpu() {},
    async capture(frame) { return { frame }; },
    retainedEvidence() {
      return {
        fixtureBufferWritesAfterInitialize: 1,
        fixtureBufferReallocationsAfterInitialize: 0,
        cameraUniformWritesAfterInitialize: submissions,
      };
    },
    async destroy() {},
  };
  await assert.rejects(runIndicatorLane(adapter, { pointSizePx: 1 }, {
    verifyCapture: async (_capture, frame) => {
      const closedFrame = frame === 100 ? 0 : frame;
      return {
        passed: true,
        artifactSha256: closedFrame.toString(16).padStart(64, '0'),
        observed: { grid: [1, 1], channels: ['coverage', 'r', 'g', 'b'], regions: [[closedFrame, 0, 0, 0]] },
      };
    },
  }), /fixture buffer write/);
  assert.equal(submissions, 5);
});

test('lane destroys partially initialized adapters when initialization fails', async () => {
  let destroyed = false;
  const adapter = {
    id: 'broken', version: '1.0.0',
    async initialize() { throw new Error('device lost'); },
    async submitFrame() {}, async completeGpu() {}, async drainGpu() {},
    async capture() {}, retainedEvidence() { return {}; },
    async destroy() { destroyed = true; },
  };
  await assert.rejects(runIndicatorLane(adapter, { pointSizePx: 1 }), /device lost/);
  assert.equal(destroyed, true);
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
  class FakeBuffer {
    constructor(size) { this.size = size; }
    async mapAsync() {}
  }
  class FakeQueue {
    writeBuffer(buffer, _offset, source) { return source.byteLength; }
  }
  class FakeDevice {
    createBuffer(descriptor) { return new FakeBuffer(descriptor.size); }
  }
  class FakeCommandEncoder {
    copyBufferToBuffer() {}
  }
  const tracker = installWebGpuFixtureTracker(1024, {
    GPUQueue: FakeQueue,
    GPUDevice: FakeDevice,
    GPUBuffer: FakeBuffer,
    GPUCommandEncoder: FakeCommandEncoder,
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
  fixtureBuffer.mapAsync(1);
  new FakeCommandEncoder().copyBufferToBuffer({ size: 4096 }, 0, fixtureBuffer, 0, 4096);
  device.createBuffer({ size: 4096, mappedAtCreation: true });
  assert.equal(tracker.evidence().fixtureBufferWritesAfterInitialize, 3);
  assert.equal(tracker.evidence().fixtureBufferReallocationsAfterInitialize, 2);
  assert.equal(tracker.evidence().fixtureBufferMapsAfterInitialize, 1);
  assert.equal(tracker.evidence().fixtureBufferCopiesAfterInitialize, 1);
  assert.equal(tracker.evidence().largeMappedAtCreationAfterInitialize, 1);
  tracker.restore();
});

test('WebGL tracker rejects split fixture uploads after initialization', () => {
  class FakeWebGl {
    constructor() { this.bound = new Map(); }
    createBuffer() { return {}; }
    bindBuffer(target, buffer) { this.bound.set(target, buffer); }
    bufferData() {}
    bufferSubData() {}
  }
  const tracker = installWebGlFixtureTracker(1024, {
    WebGLRenderingContext: FakeWebGl,
    WebGL2RenderingContext: null,
  });
  const gl = new FakeWebGl();
  const positions = gl.createBuffer();
  gl.bindBuffer(34962, positions);
  gl.bufferData(34962, new Uint8Array(2048), 35044);
  const colors = gl.createBuffer();
  gl.bindBuffer(34962, colors);
  gl.bufferData(34962, new Uint8Array(1024), 35044);
  tracker.markInitialized();
  gl.bindBuffer(34962, positions);
  gl.bufferSubData(34962, 0, new Uint8Array(2048));
  gl.bindBuffer(34962, gl.createBuffer());
  gl.bufferData(34962, 2048, 35044);
  assert.deepEqual(tracker.evidence(), {
    initialFixtureBufferWrites: 2,
    initialFixtureBufferBytes: 3072,
    initialFixtureBufferAllocations: 2,
    fixtureBufferWritesAfterInitialize: 1,
    fixtureBufferBytesAfterInitialize: 2048,
    fixtureBufferReallocationsAfterInitialize: 1,
    fixtureBufferMapsAfterInitialize: 0,
    fixtureBufferCopiesAfterInitialize: 0,
    largeMappedAtCreationAfterInitialize: 0,
  });
  tracker.restore();
});

test('capture gate requires visible colored cloud coverage in every quadrant', async () => {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (const [x, y, color] of [
    [1, 1, [230, 70, 80, 255]],
    [6, 1, [51, 210, 245, 255]],
    [1, 6, [230, 210, 80, 255]],
    [6, 6, [51, 70, 245, 255]],
  ]) rgba.set(color, (y * 8 + x) * 4);
  const result = await assessCloudCapture(rgba, 8, 8, { minimumChangedPixels: 4 });
  assert.equal(result.passed, true);
  assert.deepEqual(result.quadrantChangedPixels, [1, 1, 1, 1]);
  assert.equal(result.changedPixels, 4);
  assert.equal(result.artifactSha256.length, 64);
  rgba.fill(0, 0, 8 * 4 * 4);
  assert.equal((await assessCloudCapture(rgba, 8, 8, { minimumChangedPixels: 4 })).passed, false);
});

test('deterministic region oracle rejects reduced data and wrong orbit cameras', () => {
  const full = createCloudFixture(200);
  const reduced = createCloudFixture(100);
  const frame0 = cloudReferenceRegionStats(full, 0, [64, 64], 4, [4, 4]);
  const exact = compareCloudRegionStats(frame0, structuredClone(frame0), 0.01);
  const wrongCamera = compareCloudRegionStats(
    frame0,
    cloudReferenceRegionStats(full, 25, [64, 64], 4, [4, 4]),
    0.01,
  );
  const reducedData = compareCloudRegionStats(
    frame0,
    cloudReferenceRegionStats(reduced, 0, [64, 64], 4, [4, 4]),
    0.01,
  );
  assert.equal(exact.passed, true);
  assert.equal(wrongCamera.passed, false);
  assert.equal(reducedData.passed, false);
});

test('VKF benchmark selects exact flat opaque primitives while retaining instances', () => {
  const fixture = createCloudFixture(2);
  const instances = vkfMarkerInstances(fixture, 4, [1280, 720]);
  assert.equal(instances.length, 16);
  assert.deepEqual([...instances.slice(0, 3)], [...fixture.positions.slice(0, 3)]);
  assert.deepEqual(
    [...instances.slice(4, 7)].map((value) => Math.round(value * 255)),
    [...fixture.colors.slice(0, 3)],
  );
  assert.equal(instances[7], 1, 'fixture alpha stays unchanged for the zero-light material path');
  const discrete = createVkfMarkerScene(fixture, 1, [1280, 720]);
  const analytic = createVkfMarkerScene(fixture, 4, [1280, 720]);
  assert.equal(discrete.parts[0].topology, 'point-list');
  assert.equal(discrete.parts[0].indices.length, 1);
  assert.equal(discrete.parts[0].transparent, false);
  assert.equal(analytic.parts[0].topology, 'triangle-list');
  assert.equal(analytic.parts[0].indices.length, 6);
  assert.equal(analytic.parts[0].transparent, true);
  assert.equal(discrete.parts[0].no_lighting, true);
  assert.equal(analytic.parts[0].no_lighting, true);

  const retained = analytic.parts[0].instances;
  const revision = analytic.__revision;
  updateVkfOrbit(analytic, 25);
  assert.equal(analytic.parts[0].instances, retained);
  assert.equal(analytic.__revision, revision);
  assert.ok(analytic.camera.pos[0] > 2.9);
  assert.ok(Math.abs(analytic.camera.pos[2]) < 1e-12);
  assert.equal(analytic.parts[0].instance_kind, 'point-impostor');
  assert.equal(analytic.parts[0].static_instances, true);
  assert.equal(analytic.parts[0].overlay_expanded, true);
  assert.equal(analytic.parts[0].camera, analytic.camera);
  assert.equal(analytic.camera.projection_matrix.length, 16);
  assert.ok(Math.abs(analytic.camera.projection_matrix[5] - (1 / 1.1)) < 1e-7);

  let descriptor;
  const renderer = {
    _bindLayout: {},
    _clusteredLightBindLayout: {},
    _format: 'bgra8unorm',
    _device: {
      createShaderModule(value) { return value; },
      createPipelineLayout(value) { return value; },
      createRenderPipeline(value) { descriptor = value; return value; },
    },
  };
  createVkfFlatOpaqueMarkerPipeline(renderer, 1);
  assert.equal(descriptor.primitive.topology, 'point-list');
  assert.equal(descriptor.fragment.entryPoint, 'flatPointFragment');
  assert.equal(descriptor.fragment.targets[0].blend, undefined);
  assert.equal(descriptor.depthStencil.depthWriteEnabled, true);
  createVkfFlatOpaqueMarkerPipeline(renderer, 4);
  assert.equal(descriptor.primitive.topology, 'triangle-list');
  assert.equal(descriptor.fragment.entryPoint, 'analyticCircleFragment');
  assert.equal(descriptor.fragment.targets[0].blend.color.srcFactor, 'one');
});

test('raw WebGPU floor mutates only its bounded orbit uniform', () => {
  const frame0 = rawOrbitUniform(0, 4, [1280, 720]);
  const frame25 = rawOrbitUniform(25, 4, [1280, 720]);
  assert.equal(frame0.byteLength, 32);
  assert.deepEqual([...frame0.slice(0, 2)], [1, 0]);
  assert.ok(Math.abs(frame25[0]) < 1e-6);
  assert.equal(frame25[1], 1);
  assert.ok(Math.abs(frame0[2] - 4 / 1280) < 1e-8);
  assert.ok(Math.abs(frame0[3] - 4 / 720) < 1e-8);
  assert.equal(rawPrimitiveForPointSize(1), 'point-list');
  assert.equal(rawPrimitiveForPointSize(4), 'analytic-quad');
});

test('Three.js peer receives the exact deterministic orbit position', () => {
  assert.deepEqual(threeOrbitPosition(0), [0, 0, 3]);
  const quarter = threeOrbitPosition(25);
  assert.ok(quarter[0] > 2.99);
  assert.ok(Math.abs(quarter[2]) < 1e-12);
  assert.equal(threePrimitiveForPointSize(1), 'instanced-discrete-point-quad');
  assert.equal(threePrimitiveForPointSize(4), 'points');
});

test('deck.gl peer receives the exact deterministic orbit state', () => {
  const frame0 = deckOrbitViewState(0, [1280, 720]);
  const quarter = deckOrbitViewState(25, [1280, 720]);
  assert.deepEqual(frame0.target, [0, 0, 0]);
  assert.equal(frame0.rotationOrbit, 0);
  assert.equal(quarter.rotationOrbit, -90);
  assert.equal(frame0.rotationX, 0);
  assert.ok(Math.abs(2 ** frame0.zoom - 720 / 2.2) < 1e-10);
  assert.equal(deckPrimitiveForPointSize(1), 'custom-discrete-point-layer');
  assert.equal(deckPrimitiveForPointSize(4), 'scatterplot-layer');
});

test('suite requires both sizes, every implementation, repeated runs, and one environment', () => {
  const environmentKey = 'pinned-env';
  const rows = SUITE_IMPLEMENTATIONS.flatMap((implementation) => (
    INDICATOR_PROTOCOL.pointSizesPx.map((pointSizePx) => ({
      implementation,
      pointSizePx,
      runs: Array.from({ length: SUITE_REPEATS }, () => ({
        environmentKey,
        result: {
          correctness: { passed: true },
          timing: { retainedAfterTiming: {
            fixtureBufferWritesAfterInitialize: 0,
            fixtureBufferReallocationsAfterInitialize: 0,
          } },
        },
      })),
    }))
  ));
  assert.equal(validateSuiteMatrix(rows, environmentKey), true);
  const provisional = rows.map((row) => row.implementation === 'vkf-marker-impostor'
    ? {
        ...row,
        runs: row.runs.map(({ environmentKey: key }) => ({
          environmentKey: key,
          result: {
            correctness: {
              passed: false,
              disposition: 'correctness-unsupported-no-timing',
              failedFrames: [50],
            },
            retainedAtCorrectnessGate: {
              fixtureBufferWritesAfterInitialize: 0,
              fixtureBufferReallocationsAfterInitialize: 0,
            },
            timing: null,
          },
        })),
      }
    : row);
  assert.equal(validateSuiteMatrix(provisional, environmentKey), true);
  assert.throws(() => validateSuiteMatrix(provisional.map((row) => row.implementation === 'three-js-webgl2'
    && row.pointSizePx === 1 ? { ...row, runs: provisional[6].runs } : row), environmentKey), /correctness gate/);
  assert.throws(() => validateSuiteMatrix(rows.slice(1), environmentKey), /both 1px and 4px/);
  assert.throws(() => validateSuiteMatrix(rows.map((row, index) => (
    index === 0 ? { ...row, runs: row.runs.slice(1) } : row
  )), environmentKey), /requires 3 runs/);
  const aggregate = aggregateRunMeans([10, 20, 30]);
  assert.equal(aggregate.meanOfRunMeansMs, 20);
  assert.equal(aggregate.sampleStddevOfRunMeansMs, 10);
  assert.equal(aggregate.method, 'two-sided Student t interval, df=2');
});
