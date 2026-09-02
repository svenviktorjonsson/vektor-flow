import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  updateRoadRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-road-refinement-working-set.mjs';

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

test('road refinement retains bounded demand and regenerates evicted cells', () => {
  const field = roadField();
  const demands = [
    [5, 2, 0],
    [1, 97, 0],
    [1, 2, 0],
  ];
  const first = updateRoadRefinementWorkingSetReference(field, null, {
    demands,
    cellBudget: 2,
  });

  assert.equal(first.kind, 'road-refinement-working-set:v1');
  assert.equal(first.potentialCellCount, 300_000_000_000);
  assert.equal(first.demandCount, 3);
  assert.equal(first.cellCount, 2);
  assert.equal(first.truncated, true);
  assert.equal(first.vectorBytes, 52);
  assert.deepEqual(first.packets.map(({ id }) => id), [
    'road-cell:1:2:0',
    'road-cell:1:97:0',
  ]);
  assert.deepEqual(first.changes, {
    retained: [],
    created: ['road-cell:1:2:0', 'road-cell:1:97:0'],
    evicted: [],
  });
  const evictedPacket = first.packets[0];
  const evictedSnapshot = {
    coordinates: evictedPacket.coordinates.slice(),
    positions: evictedPacket.positions.slice(),
    layerIndices: evictedPacket.layerIndices.slice(),
  };

  const steady = updateRoadRefinementWorkingSetReference(field, first, {
    demands: [...demands].reverse(),
    cellBudget: 2,
  });
  assert.strictEqual(steady.packets[0], first.packets[0]);
  assert.strictEqual(steady.packets[1], first.packets[1]);
  assert.deepEqual(steady.changes, {
    retained: ['road-cell:1:2:0', 'road-cell:1:97:0'],
    created: [],
    evicted: [],
  });

  const moved = updateRoadRefinementWorkingSetReference(field, steady, {
    demands: [[1, 97, 0], [5, 2, 0]],
    cellBudget: 2,
  });
  assert.strictEqual(moved.packets[0], steady.packets[1]);
  assert.deepEqual(moved.changes, {
    retained: ['road-cell:1:97:0'],
    created: ['road-cell:5:2:0'],
    evicted: ['road-cell:1:2:0'],
  });

  const released = updateRoadRefinementWorkingSetReference(field, moved, {
    demands: [],
    cellBudget: 2,
  });
  assert.equal(released.cellCount, 0);
  assert.equal(released.vectorBytes, 0);
  assert.deepEqual(released.changes.evicted, [
    'road-cell:1:97:0',
    'road-cell:5:2:0',
  ]);

  const regenerated = updateRoadRefinementWorkingSetReference(field, released, {
    demands: [[1, 2, 0]],
    cellBudget: 2,
  });
  assert.notStrictEqual(regenerated.packets[0], evictedPacket);
  assert.deepEqual({
    coordinates: regenerated.packets[0].coordinates,
    positions: regenerated.packets[0].positions,
    layerIndices: regenerated.packets[0].layerIndices,
  }, evictedSnapshot);
});

test('road refinement rejects forged state and unbounded demand', () => {
  const field = roadField();
  assert.throws(
    () => updateRoadRefinementWorkingSetReference(
      field,
      { kind: 'road-refinement-working-set:v1' },
      { demands: [[1, 2, 0]], cellBudget: 1 },
    ),
    /road refinement working set is required/,
  );
  assert.throws(
    () => updateRoadRefinementWorkingSetReference(
      field,
      null,
      { demands: [[1, 2, 0]], cellBudget: 65_537 },
    ),
    /cellBudget must be an integer from 0 to 65536/,
  );
});
