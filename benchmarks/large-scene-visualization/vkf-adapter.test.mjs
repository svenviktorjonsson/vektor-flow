import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { generatePointFixture } from './materialize-fixtures.mjs';
import {
  compareRegionStats,
  idealDiscRegionStats,
  opaqueFramebufferRegionStats,
} from './point-frame-oracle.mjs';
import {
  cameraOffsetForFrame,
  createVkfLargeSceneAdapter,
} from './adapters/vkf.mjs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

function smallWorkload() {
  const workload = structuredClone(manifest.workloads[1]);
  workload.pointCount = 32;
  workload.viewport = [64, 64];
  workload.correctness.grid = [8, 8];
  const fixture = generatePointFixture(workload.fixture, workload.pointCount);
  workload.fixture.sha256 = createHash('sha256').update(fixture).digest('hex');
  return { workload, fixture };
}

function smallStaticWorkload() {
  const workload = structuredClone(manifest.workloads[0]);
  workload.pointCount = 32;
  workload.viewport = [64, 64];
  workload.correctness.grid = [8, 8];
  const fixture = generatePointFixture(workload.fixture, workload.pointCount);
  workload.fixture.sha256 = createHash('sha256').update(fixture).digest('hex');
  return { workload, fixture };
}

test('VKF adapter follows the exact manifest camera path', () => {
  const workload = manifest.workloads[1];
  assert.deepEqual(cameraOffsetForFrame(workload, 0), [0, 0.1]);
  assert.ok(Math.abs(cameraOffsetForFrame(workload, 60)[0] - 0.2) < 1e-12);
  assert.ok(Math.abs(cameraOffsetForFrame(workload, 60)[1]) < 1e-12);
  assert.ok(Math.abs(cameraOffsetForFrame(workload, 120)[0]) < 1e-12);
  assert.ok(Math.abs(cameraOffsetForFrame(workload, 120)[1] + 0.1) < 1e-12);
});

test('ideal-disc region oracle passes identical retained output and detects a wrong camera', () => {
  const { workload, fixture } = smallWorkload();
  const points = new Float32Array(Uint8Array.from(fixture).buffer);
  const frame0 = idealDiscRegionStats(points, workload, 0);
  const exact = compareRegionStats(frame0, structuredClone(frame0), workload.correctness.maxRegionError);
  const wrongCamera = compareRegionStats(
    frame0,
    idealDiscRegionStats(points, workload, 60),
    workload.correctness.maxRegionError,
  );
  assert.deepEqual(exact, { passed: true, maxRegionError: 0 });
  assert.equal(wrongCamera.passed, false);
  assert.ok(wrongCamera.maxRegionError > workload.correctness.maxRegionError);
});

test('opaque peer readback derives foreground coverage from the frozen colors', () => {
  const { workload } = smallWorkload();
  workload.viewport = [2, 1];
  workload.correctness.grid = [2, 1];
  const rgba = new Uint8Array([
    ...workload.backgroundRgba,
    ...workload.pointRgba,
  ]);
  const stats = opaqueFramebufferRegionStats(rgba, workload, 0);
  assert.ok(stats.regions[0][0] < 1e-12);
  assert.ok(Math.abs(stats.regions[1][0] - 1) < 1e-12);
  assert.ok(Math.abs(stats.regions[1][1] - workload.pointRgba[0] / 255) < 1e-12);
  assert.equal(stats.regions[0][4], 1);
});

test('VKF benchmark adapter retains exact generated x/y bytes while changing only camera uniforms', async () => {
  const { workload, fixture } = smallWorkload();
  const calls = [];
  const renderer = {
    async initialize() { return 'test'; },
    setWorldPoints(points, projection, options) { calls.push({ points, projection, options }); },
    destroy() {},
  };
  const adapter = createVkfLargeSceneAdapter({}, workload, {
    fixtureBytes: fixture,
    rendererFactory: () => renderer,
  });
  await adapter.initialize();
  adapter.renderFrame(60);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].points, calls[1].points);
  assert.equal(calls[0].points.byteLength, fixture.byteLength);
  assert.equal(
    createHash('sha256').update(new Uint8Array(calls[0].points.buffer)).digest('hex'),
    workload.fixture.sha256,
  );
  assert.notDeepEqual(calls[0].projection.worldOrigin, calls[1].projection.worldOrigin);
  assert.equal(calls[0].options.count, workload.pointCount);
  assert.equal(calls[0].options.pointSize, workload.pointDiameterPixels);
});

test('VKF fixed-camera frames reuse the initialized retained image without resubmitting state', async () => {
  const { workload, fixture } = smallStaticWorkload();
  const calls = [];
  const renderer = {
    async initialize() {},
    setWorldPoints(...values) { calls.push(values); },
    destroy() {},
  };
  const adapter = createVkfLargeSceneAdapter({}, workload, {
    fixtureBytes: fixture,
    rendererFactory: () => renderer,
  });
  await adapter.initialize();
  adapter.renderFrame(0);
  adapter.renderFrame(0);
  assert.equal(calls.length, 1);
});
