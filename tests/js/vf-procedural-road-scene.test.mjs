import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadConstructionFieldReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';
import {
  createRoadCoordinateFieldReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadWearFieldReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';
import {
  createProceduralRoadSceneReference,
} from '../../web/vf-ui/vf-procedural-road-scene.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road',
});

function sceneFixture() {
  const scheduled = [];
  const draws = [];
  let destroyed = false;
  const scene = createProceduralRoadSceneReference({
    coordinateField: createRoadCoordinateFieldReference({
      origin: [10, 20, 3],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      cellSize: [1, 0.1],
      longitudinalCells: 1_000_000_000,
      lateralCells: 100,
      layerThicknesses: [1, 2, 4],
    }),
    constructionField: createRoadConstructionFieldReference({
      ...IDENTITY,
      channel: 'road-construction',
    }),
    wearField: createRoadWearFieldReference({
      ...IDENTITY,
      channel: 'road-wear',
    }),
    frameBudget: 1,
    scheduleFrame(callback) {
      scheduled.push(callback);
    },
    drawPipeline: {
      draw(request) {
        const draw = Object.freeze({
          frame: request.frame,
          packets: request.packet.packets.length,
          uploadBytes: request.packet.delta.upload.bytes,
          remove: request.packet.delta.remove,
        });
        draws.push(draw);
        return draw;
      },
      destroy() {
        destroyed = true;
      },
      snapshot() {
        return { draws: draws.length, destroyed };
      },
    },
  });
  return { scene, scheduled, draws, destroyed: () => destroyed };
}

test('procedural road scene submits retained demand and releases its frame', async () => {
  const { scene, scheduled, draws, destroyed } = sceneFixture();
  const request = (demands) => scene.requestFrame({
    demands,
    cellBudget: 2,
    pipeline: {},
    outputBuffer: {},
    submit(draw) {
      return draw;
    },
  });
  const demands = [[1, 2, 0], [1, 97, 0]];

  const firstPending = request(demands);
  assert.equal(scheduled.length, 1);
  scheduled.shift()(10);
  const first = await firstPending;
  assert.equal(first.kind, 'procedural-material-scene-frame:v1');
  assert.deepEqual(first.output, {
    frame: 0,
    packets: 2,
    uploadBytes: 464,
    remove: [],
  });
  assert.equal(scene.snapshot().vectorBytes, 464);
  const firstPackets = scene.snapshot().wearPackets.packets;

  const steadyPending = request([...demands].reverse());
  scheduled.shift()(26);
  const steady = await steadyPending;
  assert.deepEqual(steady.output, {
    frame: 1,
    packets: 2,
    uploadBytes: 0,
    remove: [],
  });
  assert.strictEqual(scene.snapshot().wearPackets.packets[0], firstPackets[0]);
  assert.strictEqual(scene.snapshot().wearPackets.packets[1], firstPackets[1]);

  const releasedPending = request([]);
  scheduled.shift()(42);
  const released = await releasedPending;
  assert.deepEqual(released.output, {
    frame: 2,
    packets: 0,
    uploadBytes: 0,
    remove: ['road:cell:1:2:0', 'road:cell:1:97:0'],
  });
  assert.equal(scene.snapshot().vectorBytes, 0);
  assert.equal(scene.snapshot().refinement.cellCount, 0);
  assert.equal(draws.length, 3);

  scene.destroy();
  assert.equal(destroyed(), true);
  assert.equal(scene.snapshot().scheduler.destroyed, true);
});

test('rejected road frame leaves retained scene state unchanged', async () => {
  const { scene, scheduled } = sceneFixture();
  const firstPending = scene.requestFrame({
    demands: [[1, 2, 0]],
    cellBudget: 1,
    pipeline: {},
    outputBuffer: {},
    submit(draw) {
      return draw;
    },
  });
  scheduled.shift()(10);
  await firstPending;
  const before = scene.snapshot();

  await assert.rejects(
    scene.requestFrame({
      demands: [[5, 2, 0]],
      cellBudget: 1,
      pipeline: {},
      outputBuffer: {},
      submit: null,
    }),
    /procedural material scene-frame request is required/,
  );
  const after = scene.snapshot();
  assert.strictEqual(after.refinement, before.refinement);
  assert.strictEqual(after.constructionPackets, before.constructionPackets);
  assert.strictEqual(after.wearPackets, before.wearPackets);
  assert.equal(after.vectorBytes, before.vectorBytes);
  assert.equal(scheduled.length, 0);
  scene.destroy();
});
