import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';

test('road cells share bounded geometry and material coordinates across layers', () => {
  const field = createRoadCoordinateFieldReference({
    origin: [10, 20, 3],
    forward: [1, 0, 0],
    up: [0, 0, 1],
    cellSize: [4, 2],
    longitudinalCells: 1_000_000_000,
    lateralCells: 4,
    layerThicknesses: [1, 2, 4],
  });
  const workingSet = realizeRoadCoordinateCellsReference(field, {
    cells: [
      [3, 1, 0],
      [7, 2, 1],
      [11, 0, 2],
    ],
    cellBudget: 2,
  });

  assert.equal(workingSet.kind, 'road-coordinate-working-set:v1');
  assert.equal(workingSet.cellCount, 2);
  assert.equal(workingSet.potentialCellCount, 12_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 52);
  assert.strictEqual(workingSet.geometry, workingSet.material);
  assert.deepEqual(Array.from(workingSet.geometry.coordinates), [
    14, -1, -0.5,
    30, 1, -2,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.positions), [
    24, 19, 2.5,
    40, 21, 1,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.layerIndices), [0, 1]);
});
