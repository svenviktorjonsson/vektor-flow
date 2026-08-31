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
