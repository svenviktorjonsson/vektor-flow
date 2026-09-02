import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadConstructionFieldReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';
import {
  adaptRoadRefinementToConstructionPacketsReference,
} from '../../web/vf-ui/vf-road-construction-renderer-packets.mjs';
import {
  createRoadCoordinateFieldReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  updateRoadRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-road-refinement-working-set.mjs';
import {
  createRoadWearFieldReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';
import {
  adaptRoadConstructionToWearPacketsReference,
} from '../../web/vf-ui/vf-road-wear-renderer-packets.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road',
});

function roadField() {
  return createRoadCoordinateFieldReference({
    origin: [10, 20, 3],
    forward: [1, 0, 0],
    up: [0, 0, 1],
    cellSize: [1, 0.1],
    longitudinalCells: 1_000_000_000,
    lateralCells: 100,
    layerThicknesses: [1, 2, 4],
  });
}

test('road wear composes retained construction geometry and PBR packets', () => {
  const coordinates = roadField();
  const construction = createRoadConstructionFieldReference({
    ...IDENTITY,
    channel: 'road-construction',
  });
  const wear = createRoadWearFieldReference({
    ...IDENTITY,
    channel: 'road-wear',
  });
  const demands = [[1, 2, 0], [1, 97, 0]];
  const firstWorking = updateRoadRefinementWorkingSetReference(
    coordinates,
    null,
    { demands, cellBudget: 2 },
  );
  const firstConstruction = adaptRoadRefinementToConstructionPacketsReference(
    firstWorking,
    coordinates,
    construction,
    null,
  );
  const first = adaptRoadConstructionToWearPacketsReference(
    firstConstruction,
    firstWorking,
    wear,
    null,
  );

  assert.equal(first.kind, 'road-wear-renderer-packets:v1');
  assert.deepEqual(first.packets.map(({ id }) => id), [
    'road:cell:1:2:0',
    'road:cell:1:97:0',
  ]);
  assert.deepEqual(first.delta.upsert.map(({ id }) => id), [
    'road:cell:1:2:0',
    'road:cell:1:97:0',
  ]);
  assert.deepEqual(first.delta.upload, { packets: 2, bytes: 464 });
  for (let index = 0; index < first.packets.length; index += 1) {
    const packet = first.packets[index];
    const base = firstConstruction.packets[index];
    assert.equal(packet.type, 'field_mesh');
    assert.equal(packet.vectorBytes, 232);
    assert.strictEqual(packet.indices, base.indices);
    assert.ok(packet.vertices[2] < base.vertices[2]);
    assert.ok(packet.vertices[6] < base.vertices[6]);
    assert.equal(packet.material_channels.trafficExposureDrivers.length, 2);
    assert.equal(packet.material_channels.albedo.length, 3);
    assert.equal(packet.material_channels.roughness.length, 1);
    assert.equal(packet.material_channels.wetness.length, 1);
    assert.equal(packet.material_channels.wearDisplacement.length, 1);
    assert.deepEqual(
      Array.from(packet.vertices.subarray(6, 9)),
      Array.from(packet.material_channels.albedo),
    );
  }
  assert.deepEqual(Array.from(first.packets[0].vertices.subarray(0, 10)), [
    11,
    15.199999809265137,
    2.4840853214263916,
    0,
    0,
    1,
    0.12572957575321198,
    0.12085218727588654,
    0.11571287363767624,
    1,
  ]);
  assert.equal(first.packets[0].specular_strength, 0.3901347517967224);
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.trafficExposureDrivers),
    [0.5893970131874084, -0.30302128195762634],
  );
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.roughness),
    [0.6098652482032776],
  );
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.wearDisplacement),
    [-0.016520893201231956],
  );
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.wetness),
    [0.6069899797439575],
  );

  const steadyWorking = updateRoadRefinementWorkingSetReference(
    coordinates,
    firstWorking,
    { demands: [...demands].reverse(), cellBudget: 2 },
  );
  const steadyConstruction = adaptRoadRefinementToConstructionPacketsReference(
    steadyWorking,
    coordinates,
    construction,
    firstConstruction,
  );
  const steady = adaptRoadConstructionToWearPacketsReference(
    steadyConstruction,
    steadyWorking,
    wear,
    first,
  );
  assert.strictEqual(steady.packets[0], first.packets[0]);
  assert.strictEqual(steady.packets[1], first.packets[1]);
  assert.deepEqual(steady.delta.upsert, []);
  assert.deepEqual(steady.delta.remove, []);
  assert.deepEqual(steady.delta.unchanged, first.packets.map(({ id }) => id));
  assert.deepEqual(steady.delta.upload, { packets: 0, bytes: 0 });
});

test('road wear packets reject malformed and cross-field retained state', () => {
  const coordinates = roadField();
  const construction = createRoadConstructionFieldReference({
    ...IDENTITY,
    channel: 'road-construction',
  });
  const wear = createRoadWearFieldReference({
    ...IDENTITY,
    channel: 'road-wear',
  });
  const working = updateRoadRefinementWorkingSetReference(
    coordinates,
    null,
    { demands: [[1, 2, 0]], cellBudget: 1 },
  );
  const constructionPackets = adaptRoadRefinementToConstructionPacketsReference(
    working,
    coordinates,
    construction,
    null,
  );
  const adapted = adaptRoadConstructionToWearPacketsReference(
    constructionPackets,
    working,
    wear,
    null,
  );

  assert.throws(
    () => adaptRoadConstructionToWearPacketsReference(
      {}, working, wear, null,
    ),
    /road construction packets and refinement are required/,
  );
  assert.throws(
    () => adaptRoadConstructionToWearPacketsReference(
      constructionPackets, working, wear, {},
    ),
    /retained road wear packet state is invalid/,
  );
  assert.throws(
    () => adaptRoadConstructionToWearPacketsReference(
      constructionPackets,
      working,
      createRoadWearFieldReference({ ...IDENTITY, channel: 'other-wear' }),
      adapted,
    ),
    /retained road wear packet state owns another field/,
  );
});
