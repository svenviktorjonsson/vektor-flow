import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadCrackFieldReference,
  realizeRoadCrackCellsReference,
} from '../../web/vf-ui/vf-road-crack-field.mjs';
import {
  createRoadRepairFieldReference,
  realizeRoadRepairCellsReference,
} from '../../web/vf-ui/vf-road-repair-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const CRACK_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x510e527f, 0x9b05688c]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-cracks',
});

const REPAIR_IDENTITY = Object.freeze({
  ...CRACK_IDENTITY,
  channel: 'road-repairs',
});

function roadCracks() {
  const coordinates = realizeRoadCoordinateCellsReference(
    createRoadCoordinateFieldReference({
      origin: [10, 20, 3],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      cellSize: [4, 2],
      longitudinalCells: 1_000_000_000,
      lateralCells: 4,
      layerThicknesses: [1, 2, 4],
    }),
    {
      cells: [
        [3, 1, 0],
        [4, 1, 0],
        [7, 2, 1],
        [8, 2, 0],
      ],
      cellBudget: 4,
    },
  );
  const wear = realizeRoadWearCellsReference(
    createRoadWearFieldReference(CRACK_IDENTITY),
    coordinates,
    { sampleBudget: 4 },
  );
  return realizeRoadCrackCellsReference(
    createRoadCrackFieldReference(CRACK_IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
}

test('bounded repairs fill cracked geometry and share repaired PBR coverage', () => {
  const cracks = roadCracks();
  const realize = () => realizeRoadRepairCellsReference(
    createRoadRepairFieldReference(REPAIR_IDENTITY),
    cracks,
    { sampleBudget: 3 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-repair-working-set:v1');
  assert.equal(workingSet.sampleCount, 3);
  assert.equal(workingSet.potentialCellCount, 12_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 108);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.repairCoverage,
    workingSet.material.repairCoverage,
  );
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    cracks.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.repairDriver), [
    0.6401003003120422,
    0.23987063765525818,
    -0.47974637150764465,
  ]);
  assert.deepEqual(Array.from(workingSet.repairAmount), [
    0.8100250959396362,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.repairCoverage), [
    0.3737914562225342,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.displacement), [
    -0.0001009905754472129,
    0,
    0,
  ]);

  assert.ok(workingSet.geometry.repairCoverage[0] > 0);
  assert.deepEqual(Array.from(workingSet.geometry.repairCoverage.subarray(1)), [0, 0]);
  assert.ok(
    workingSet.geometry.displacement[0]
      > cracks.geometry.displacement[0],
  );
  assert.deepEqual(
    Array.from(workingSet.geometry.displacement.subarray(1)),
    Array.from(cracks.geometry.displacement.subarray(1, 3)),
  );
  assert.ok(workingSet.material.albedo[0] > cracks.material.albedo[0]);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(3)),
    Array.from(cracks.material.albedo.subarray(3, 9)),
  );
});

test('road repairs reject forged crack state and unbounded demand', () => {
  const field = createRoadRepairFieldReference(REPAIR_IDENTITY);
  assert.throws(
    () => realizeRoadRepairCellsReference(
      field,
      { kind: 'road-crack-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road crack working set is required/,
  );
  assert.throws(
    () => realizeRoadRepairCellsReference(
      field,
      roadCracks(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
