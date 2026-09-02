import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadEdgeBreakdownFieldReference,
  realizeRoadEdgeBreakdownCellsReference,
} from '../../web/vf-ui/vf-road-edge-breakdown-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const WEAR_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0xc1059ed8, 0x367cd507]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-wear',
});

const EDGE_IDENTITY = Object.freeze({
  ...WEAR_IDENTITY,
  channel: 'road-edge-breakdown',
});

function roadWear() {
  const coordinates = realizeRoadCoordinateCellsReference(
    createRoadCoordinateFieldReference({
      origin: [10, 20, 3],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      cellSize: [1, 0.1],
      longitudinalCells: 1_000_000_000,
      lateralCells: 100,
      layerThicknesses: [1, 2, 4],
    }),
    {
      cells: [
        [0, 49, 0],
        [0, 5, 0],
        [1, 94, 0],
        [0, 5, 1],
        [10, 5, 0],
      ],
      cellBudget: 5,
    },
  );
  return realizeRoadWearCellsReference(
    createRoadWearFieldReference(WEAR_IDENTITY),
    coordinates,
    { sampleBudget: 5 },
  );
}

test('bounded road edges share eroded geometry and PBR integrity', () => {
  const wear = roadWear();
  const realize = () => realizeRoadEdgeBreakdownCellsReference(
    createRoadEdgeBreakdownFieldReference(EDGE_IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-edge-breakdown-working-set:v1');
  assert.equal(workingSet.sampleCount, 4);
  assert.equal(workingSet.potentialCellCount, 300_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 144);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.edgeIntegrity,
    workingSet.material.edgeIntegrity,
  );
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.erosionDriver), [
    -0.06021684780716896,
    -0.17529435455799103,
    -0.47119569778442383,
    -0.17529435455799103,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.edgeIntegrity), [
    1,
    0.6676010489463806,
    0.7234606742858887,
    1,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.recession), [
    0,
    0.013295956887304783,
    0.011061574332416058,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.displacement), [
    0,
    -0.00797757413238287,
    -0.0066369445994496346,
    0,
  ]);

  assert.equal(workingSet.geometry.edgeIntegrity[0], 1);
  assert.ok(workingSet.geometry.edgeIntegrity[1] < 1);
  assert.ok(workingSet.geometry.edgeIntegrity[2] < 1);
  assert.equal(workingSet.geometry.edgeIntegrity[3], 1);
  assert.equal(workingSet.geometry.recession[0], 0);
  assert.ok(workingSet.geometry.recession[1] > 0);
  assert.ok(workingSet.geometry.recession[2] > 0);
  assert.ok(workingSet.geometry.displacement[1] < 0);
  assert.ok(workingSet.geometry.displacement[2] < 0);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(0, 3)),
    Array.from(wear.material.albedo.subarray(0, 3)),
  );
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(9, 12)),
    Array.from(wear.material.albedo.subarray(9, 12)),
  );
});

test('road edge breakdown rejects forged wear state and unbounded demand', () => {
  const field = createRoadEdgeBreakdownFieldReference(EDGE_IDENTITY);
  assert.throws(
    () => realizeRoadEdgeBreakdownCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadEdgeBreakdownCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
