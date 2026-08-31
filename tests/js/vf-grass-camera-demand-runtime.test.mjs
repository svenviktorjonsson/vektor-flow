import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createGrassMaterialFieldReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';
import {
  createRetainedGeometryPacketRuntimeReference,
} from '../../web/vf-ui/vf-rock-camera-demand-runtime.mjs';
import {
  createGrassCameraDemandControllerReference,
} from '../../web/vf-ui/vf-grass-camera-demand-runtime.mjs';

const field = () => createGrassMaterialFieldReference({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:3'],
  lod: 0,
  channel: 'surface',
});

const camera = (eye, target = [0, 0, 0]) => Object.freeze({
  eye: Object.freeze(eye),
  target: Object.freeze(target),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportWidth: 800,
  viewportHeight: 600,
});

test('grass camera demand coalesces revisions before generating retained packets', async () => {
  const jobs = [];
  const renders = [];
  const runtime = createRetainedGeometryPacketRuntimeReference({
    requestRender: (packets, receipt) => renders.push({ packets, receipt }),
  });
  const controller = createGrassCameraDemandControllerReference({
    field: field(),
    runtime,
    schedule: (job) => jobs.push(job),
    planeZ: 0,
    maximumDistance: 64,
    cellBudget: 32,
    bladeBudget: 256,
  });

  const first = controller.request({
    revision: 1,
    camera: camera([0, -8, 5]),
  });
  const second = controller.request({
    revision: 2,
    camera: camera([8, 0, 5]),
  });

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
  assert.equal(applied.cells.length, 32);
  assert.ok(applied.runtime.upload.bytes > 0);
  assert.equal(runtime.packets().length, 32);
  assert.equal(renders.length, 1);
  assert.deepEqual(controller.status(), {
    scheduled: false,
    pendingRevision: null,
    committedRevision: 2,
    packetCount: 32,
  });
});

test('steady grass demand is upload-free and preserves retained packet objects', async () => {
  const jobs = [];
  const renders = [];
  const runtime = createRetainedGeometryPacketRuntimeReference({
    requestRender: (packets) => renders.push(packets),
  });
  const controller = createGrassCameraDemandControllerReference({
    field: field(),
    runtime,
    schedule: (job) => jobs.push(job),
    planeZ: 0,
    maximumDistance: 64,
    cellBudget: 32,
    bladeBudget: 256,
  });
  const view = camera([0, -8, 5]);

  const initial = controller.request({ revision: 1, camera: view });
  jobs.shift()();
  await initial;
  const retained = runtime.packets();

  const steady = controller.request({ revision: 2, camera: view });
  jobs.shift()();
  const receipt = await steady;

  assert.equal(receipt.runtime.changed, false);
  assert.deepEqual(receipt.runtime.upload, {
    packets: 0,
    blades: 0,
    vertexBytes: 0,
    indexBytes: 0,
    bytes: 0,
  });
  assert.equal(renders.length, 1);
  assert.deepEqual(runtime.packets(), retained);
  runtime.packets().forEach((packet, index) => {
    assert.strictEqual(packet, retained[index]);
  });
});

test('moving the grass view retains shared cells and evicts out-of-view packets', async () => {
  const jobs = [];
  const runtime = createRetainedGeometryPacketRuntimeReference();
  const controller = createGrassCameraDemandControllerReference({
    field: field(),
    runtime,
    schedule: (job) => jobs.push(job),
    planeZ: 0,
    maximumDistance: 64,
    cellBudget: 64,
    bladeBudget: 512,
  });
  const run = async (revision, view) => {
    const completion = controller.request({ revision, camera: view });
    jobs.shift()();
    return completion;
  };

  await run(1, camera([0, -8, 5]));
  const initial = runtime.packets();
  const initialById = new Map(initial.map((packet) => [packet.id, packet]));
  const changed = await run(2, camera([2, -8, 5], [2, 0, 0]));
  const moved = runtime.packets();
  const shared = moved.filter((packet) => initialById.has(packet.id));

  assert.ok(changed.runtime.removed.length > 0);
  assert.ok(changed.runtime.upserted.length > 0);
  assert.ok(changed.runtime.upload.bytes <= 512 * 184);
  assert.ok(shared.length > 0);
  shared.forEach((packet) => {
    assert.strictEqual(packet, initialById.get(packet.id));
  });
});

test('offscreen fixture coalesces a horizon-clipped zero-light grass view', async () => {
  const html = await readFile(
    new URL('../fixtures/grass-camera-demand-runtime-smoke.html', import.meta.url),
    'utf8',
  );

  assert.match(html, /createGrassCameraDemandControllerReference/);
  assert.match(html, /maximumDistance: 50/);
  assert.match(html, /lights: \[\]/);
  assert.match(html, /__grassCameraDemandRuntimeEvidence/);
});
