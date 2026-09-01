import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from '../../web/vf-ui/vf-forest-population.mjs';
import {
  createTreePacketRuntimeCacheReference,
} from '../../web/vf-ui/vf-tree-packet-runtime.mjs';
import {
  createTreeCameraDemandControllerReference,
} from '../../web/vf-ui/vf-tree-camera-demand-runtime.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

const CAMERA = Object.freeze({
  eye: Object.freeze([30, 50, 40]),
  target: Object.freeze([-32, 128, 14]),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportWidth: 1280,
  viewportHeight: 720,
  maximumDistance: 180,
});

test('tree camera controller coalesces revisions before realizing packets', async () => {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    {
      patches: [[-2, 3], [-1, 3], [-2, 4], [-1, 4]],
      treeBudget: 128,
    },
  );
  const jobs = [];
  const renders = [];
  const runtime = createTreePacketRuntimeCacheReference({
    byteBudget: 256 * 71,
    requestRender: (packets, receipt) => renders.push({ packets, receipt }),
  });
  const controller = createTreeCameraDemandControllerReference({
    identity: IDENTITY,
    forest,
    runtime,
    schedule: (job) => jobs.push(job),
    treeBudget: 24,
    primitiveBudget: 256,
  });

  const first = controller.request({
    revision: 1,
    camera: { ...CAMERA, eye: [-30, 50, 40] },
  });
  const second = controller.request({ revision: 2, camera: CAMERA });

  assert.equal(jobs.length, 1);
  assert.deepEqual(runtime.packets(), []);
  assert.deepEqual(controller.status(), {
    scheduled: true,
    pendingRevision: 2,
    committedRevision: 0,
    packetCount: 0,
    primitiveCount: 0,
    bytes: 0,
  });
  jobs.shift()();

  assert.deepEqual(await first, {
    status: 'superseded',
    revision: 1,
    byRevision: 2,
  });
  const applied = await second;
  assert.equal(applied.status, 'applied');
  assert.equal(applied.revision, 2);
  assert.equal(applied.demandTreeCount, 24);
  assert.equal(applied.plannedPrimitiveCount, 256);
  assert.equal(applied.runtime.packetCount, 24);
  assert.equal(applied.runtime.primitiveCount, 256);
  assert.equal(applied.runtime.bytes, 256 * 71);
  assert.equal(renders.length, 1);
  assert.deepEqual(controller.status(), {
    scheduled: false,
    pendingRevision: null,
    committedRevision: 2,
    packetCount: 24,
    primitiveCount: 256,
    bytes: 256 * 71,
  });
});

test('tree camera controller releases far-view packets and regenerates identities', async () => {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    {
      patches: [[-2, 3], [-1, 3], [-2, 4], [-1, 4]],
      treeBudget: 128,
    },
  );
  const jobs = [];
  const runtime = createTreePacketRuntimeCacheReference({
    byteBudget: 256 * 71,
  });
  const controller = createTreeCameraDemandControllerReference({
    identity: IDENTITY,
    forest,
    runtime,
    schedule: (job) => jobs.push(job),
    treeBudget: 24,
    primitiveBudget: 256,
  });
  const run = async (revision, camera) => {
    const completion = controller.request({ revision, camera });
    jobs.shift()();
    return completion;
  };

  const initial = await run(1, CAMERA);
  const initialPackets = runtime.packets();
  assert.equal(initial.runtime.bytes, 256 * 71);

  const far = await run(2, { ...CAMERA, maximumDistance: 20 });
  assert.equal(far.demandTreeCount, 0);
  assert.equal(far.runtime.packetCount, 0);
  assert.equal(far.runtime.bytes, 0);
  assert.deepEqual(runtime.packets(), []);

  const returned = await run(3, CAMERA);
  const returnedPackets = runtime.packets();
  assert.equal(returned.runtime.upload.bytes, 256 * 71);
  assert.deepEqual(returnedPackets, initialPackets);
  assert.ok(returnedPackets.every((packet, index) => packet !== initialPackets[index]));

  assert.deepEqual(await controller.request({ revision: 3, camera: CAMERA }), {
    status: 'stale',
    revision: 3,
    committedRevision: 3,
    pendingRevision: null,
  });
  assert.equal(jobs.length, 0);
});
