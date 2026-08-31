import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';
import {
  createEllipsoidCameraDemandControllerReference,
  createRetainedGeometryPacketRuntimeReference,
} from '../../web/vf-ui/vf-rock-camera-demand-runtime.mjs';

const camera = (eye) => Object.freeze({
  eye: Object.freeze(eye),
  target: Object.freeze([0, 0, 0]),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportHeight: 1080,
});

test('camera demand coalesces superseded revisions before touching retained packets', async () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const jobs = [];
  const renders = [];
  const runtime = createRetainedGeometryPacketRuntimeReference({
    requestRender: (packets, receipt) => renders.push({ packets, receipt }),
  });
  const controller = createEllipsoidCameraDemandControllerReference({
    coarse,
    runtime,
    schedule: (job) => jobs.push(job),
    maxErrorPixels: 0,
    refinementBudget: 4,
    vertexBudget: 2,
    faceBudget: 6,
  });

  const first = controller.request({ revision: 1, camera: camera([8, 0, 0]) });
  const second = controller.request({ revision: 2, camera: camera([-8, 0, 0]) });

  assert.equal(jobs.length, 1);
  assert.deepEqual(runtime.packets(), []);
  jobs.shift()();

  assert.deepEqual(await first, {
    status: 'superseded',
    revision: 1,
    byRevision: 2,
  });
  const applied = await second;
  assert.equal(applied.status, 'applied');
  assert.equal(applied.revision, 2);
  assert.deepEqual(applied.demandFaces, [
    'face:-x:+y:+z',
    'face:-x:+y:-z',
  ]);
  assert.deepEqual(runtime.packets().map(({ id }) => id), [
    'rock:ellipsoid-octahedron:v1:coarse',
    'rock:detail:face:-x:+y:+z',
    'rock:detail:face:-x:+y:-z',
  ]);
  assert.equal(renders.length, 1);
  assert.deepEqual(controller.status(), {
    scheduled: false,
    pendingRevision: null,
    committedRevision: 2,
    packetCount: 3,
  });
});

test('steady demand is upload-free and rejects stale camera revisions', async () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const jobs = [];
  const renders = [];
  const runtime = createRetainedGeometryPacketRuntimeReference({
    requestRender: (packets, receipt) => renders.push({ packets, receipt }),
  });
  const controller = createEllipsoidCameraDemandControllerReference({
    coarse,
    runtime,
    schedule: (job) => jobs.push(job),
    maxErrorPixels: 0,
    refinementBudget: 4,
    vertexBudget: 2,
    faceBudget: 6,
  });

  const initial = controller.request({ revision: 1, camera: camera([8, 0, 0]) });
  jobs.shift()();
  assert.equal((await initial).status, 'applied');
  assert.equal(renders.length, 1);

  assert.deepEqual(await controller.request({
    revision: 1,
    camera: camera([-8, 0, 0]),
  }), {
    status: 'stale',
    revision: 1,
    committedRevision: 1,
    pendingRevision: null,
  });
  assert.equal(jobs.length, 0);

  const steady = controller.request({ revision: 2, camera: camera([8, 0, 0]) });
  jobs.shift()();
  const receipt = await steady;
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.runtime.changed, false);
  assert.deepEqual(receipt.runtime.upload, {
    packets: 0,
    vertices: 0,
    faces: 0,
    vertexFloats: 0,
    indices: 0,
    bytes: 0,
  });
  assert.equal(renders.length, 1);
});

test('camera changes upload one bounded detail and regenerate evicted packets exactly', async () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const jobs = [];
  const runtime = createRetainedGeometryPacketRuntimeReference();
  const controller = createEllipsoidCameraDemandControllerReference({
    coarse,
    runtime,
    schedule: (job) => jobs.push(job),
    maxErrorPixels: 0,
    refinementBudget: 4,
    vertexBudget: 2,
    faceBudget: 6,
  });
  const run = async (revision, eye) => {
    const completion = controller.request({ revision, camera: camera(eye) });
    jobs.shift()();
    return completion;
  };

  await run(1, [8, 0, 0]);
  const initial = runtime.packets();
  const changed = await run(2, [8, 0, -2]);
  const changedPackets = runtime.packets();

  assert.deepEqual(changed.runtime.upserted, [
    'rock:detail:face:+x:-y:-z',
  ]);
  assert.deepEqual(changed.runtime.removed, [
    'rock:detail:face:+x:+y:+z',
  ]);
  assert.deepEqual(changed.runtime.upload, {
    packets: 1,
    vertices: 4,
    faces: 3,
    vertexFloats: 40,
    indices: 9,
    bytes: 196,
  });
  assert.strictEqual(changedPackets[0], initial[0]);
  assert.strictEqual(
    changedPackets[1],
    initial[2],
  );

  const returned = await run(3, [8, 0, 0]);
  const regenerated = runtime.packets();
  assert.deepEqual(returned.runtime.upserted, [
    'rock:detail:face:+x:+y:+z',
  ]);
  assert.deepEqual(regenerated, initial);
  assert.strictEqual(regenerated[0], initial[0]);
  assert.notStrictEqual(regenerated[1], initial[1]);
  assert.strictEqual(regenerated[2], initial[2]);
});
