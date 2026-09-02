import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadConstructionFieldReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';
import {
  createRoadCoordinateFieldReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  adaptRoadRefinementToConstructionPacketsReference,
} from '../../web/vf-ui/vf-road-construction-renderer-packets.mjs';
import {
  updateRoadRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-road-refinement-working-set.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-construction',
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

test('road construction emits retained field-mesh packets for demanded cells', () => {
  const coordinates = roadField();
  const construction = createRoadConstructionFieldReference(IDENTITY);
  const demands = [[1, 2, 0], [1, 97, 0]];
  const firstWorking = updateRoadRefinementWorkingSetReference(
    coordinates,
    null,
    { demands, cellBudget: 2 },
  );
  const first = adaptRoadRefinementToConstructionPacketsReference(
    firstWorking,
    coordinates,
    construction,
    null,
  );

  assert.equal(first.kind, 'road-construction-renderer-packets:v1');
  assert.deepEqual(first.packets.map(({ id }) => id), [
    'road:cell:1:2:0',
    'road:cell:1:97:0',
  ]);
  assert.deepEqual(first.delta.upsert.map(({ id }) => id), [
    'road:cell:1:2:0',
    'road:cell:1:97:0',
  ]);
  assert.deepEqual(first.delta.remove, []);
  assert.deepEqual(first.delta.unchanged, []);
  assert.deepEqual(first.delta.upload, { packets: 2, bytes: 432 });

  for (const packet of first.packets) {
    assert.equal(packet.type, 'field_mesh');
    assert.equal(packet.topology, 'triangle-list');
    assert.equal(packet.mode3d, true);
    assert.equal(packet.receives_lighting, true);
    assert.equal(packet.casts_shadow, true);
    assert.equal(packet.receives_shadow, true);
    assert.equal(packet.vertices.length, 40);
    assert.deepEqual(Array.from(packet.indices), [0, 1, 2, 0, 2, 3]);
    assert.deepEqual(
      Array.from(packet.vertices.subarray(6, 9)),
      Array.from(packet.material_channels.albedo),
    );
    assert.ok([...packet.vertices].every(Number.isFinite));
  }
  assert.equal(first.packets[0].object_id, 179019889);
  assert.equal(first.packets[0].vectorBytes, 216);
  assert.deepEqual(Array.from(first.packets[0].vertices.subarray(0, 10)), [
    11,
    15.199999809265137,
    2.5006062984466553,
    0,
    0,
    1,
    0.16823329031467438,
    0.1617070734500885,
    0.15483038127422333,
    1,
  ]);
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.aggregateFraction),
    [0.582526445388794],
  );
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.binderFraction),
    [0.3504771292209625],
  );
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.voidFraction),
    [0.06699643284082413],
  );
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.roughness),
    [0.763088047504425],
  );
  assert.deepEqual(
    Array.from(first.packets[0].material_channels.displacement),
    [0.0006063447799533606],
  );

  const steadyWorking = updateRoadRefinementWorkingSetReference(
    coordinates,
    firstWorking,
    { demands: [...demands].reverse(), cellBudget: 2 },
  );
  const steady = adaptRoadRefinementToConstructionPacketsReference(
    steadyWorking,
    coordinates,
    construction,
    first,
  );
  assert.strictEqual(steady.packets[0], first.packets[0]);
  assert.strictEqual(steady.packets[1], first.packets[1]);
  assert.deepEqual(steady.delta.upsert, []);
  assert.deepEqual(steady.delta.remove, []);
  assert.deepEqual(steady.delta.unchanged, first.packets.map(({ id }) => id));
  assert.equal(steady.delta.upload.bytes, 0);

  const changedWorking = updateRoadRefinementWorkingSetReference(
    coordinates,
    steadyWorking,
    { demands: [[1, 97, 0], [5, 2, 0]], cellBudget: 2 },
  );
  const changed = adaptRoadRefinementToConstructionPacketsReference(
    changedWorking,
    coordinates,
    construction,
    steady,
  );
  assert.strictEqual(changed.packets[0], first.packets[1]);
  assert.deepEqual(changed.delta.upsert.map(({ id }) => id), [
    'road:cell:5:2:0',
  ]);
  assert.deepEqual(changed.delta.remove, ['road:cell:1:2:0']);
  assert.deepEqual(changed.delta.unchanged, ['road:cell:1:97:0']);
});

test('road construction packets reject malformed and cross-field retained state', () => {
  const coordinates = roadField();
  const construction = createRoadConstructionFieldReference(IDENTITY);
  const working = updateRoadRefinementWorkingSetReference(
    coordinates,
    null,
    { demands: [[1, 2, 0]], cellBudget: 1 },
  );
  const adapted = adaptRoadRefinementToConstructionPacketsReference(
    working,
    coordinates,
    construction,
    null,
  );

  assert.throws(
    () => adaptRoadRefinementToConstructionPacketsReference(
      {}, coordinates, construction, null,
    ),
    /road refinement working set is required/,
  );
  assert.throws(
    () => adaptRoadRefinementToConstructionPacketsReference(
      working, coordinates, construction, {},
    ),
    /retained road construction packet state is invalid/,
  );
  assert.throws(
    () => adaptRoadRefinementToConstructionPacketsReference(
      working, roadField(), construction, adapted,
    ),
    /retained road construction packet state owns another field/,
  );
});
