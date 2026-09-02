import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadShoulderFieldReference,
  realizeRoadShoulderCellsReference,
} from '../../web/vf-ui/vf-road-shoulder-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const WEAR_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-wear',
});

const SHOULDER_IDENTITY = Object.freeze({
  ...WEAR_IDENTITY,
  channel: 'road-shoulder',
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
        [0, 2, 0],
        [1, 97, 0],
        [0, 2, 1],
        [10, 2, 0],
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

test('bounded road shoulders share lowered geometry and compacted PBR', () => {
  const wear = roadWear();
  const realize = () => realizeRoadShoulderCellsReference(
    createRoadShoulderFieldReference(SHOULDER_IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-shoulder-working-set:v1');
  assert.equal(workingSet.sampleCount, 4);
  assert.equal(workingSet.potentialCellCount, 300_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 128);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.shoulderState,
    workingSet.material.shoulderState,
  );
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.compactionDriver), [
    -0.15463092923164368,
    0.1571117788553238,
    -0.2602981626987457,
    0.1571117788553238,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.shoulderState), [
    0,
    0.7213455438613892,
    0.6429274678230286,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.displacement), [
    -0.016560515388846397,
    -0.04580290615558624,
    -0.04307270050048828,
    -0.016535690054297447,
  ]);
  assert.deepEqual(Array.from(workingSet.material.roughness), [
    0.5303807854652405,
    0.7780008912086487,
    0.7609106302261353,
    0.5309439301490784,
  ]);
  assert.deepEqual(Array.from(workingSet.material.wetness), [
    0.6076497435569763,
    0.5169774293899536,
    0.5189902186393738,
    0.6070681810379028,
  ]);

  assert.equal(workingSet.geometry.shoulderState[0], 0);
  assert.ok(workingSet.geometry.shoulderState[1] > 0);
  assert.ok(workingSet.geometry.shoulderState[2] > 0);
  assert.equal(workingSet.geometry.shoulderState[3], 0);
  assert.ok(
    workingSet.geometry.displacement[1] < wear.geometry.displacement[1],
  );
  assert.ok(
    workingSet.material.roughness[1] > wear.material.roughness[1],
  );
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(0, 3)),
    Array.from(wear.material.albedo.subarray(0, 3)),
  );
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(9, 12)),
    Array.from(wear.material.albedo.subarray(9, 12)),
  );
});

test('road shoulders reject forged wear state and unbounded demand', () => {
  const field = createRoadShoulderFieldReference(SHOULDER_IDENTITY);
  assert.throws(
    () => realizeRoadShoulderCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadShoulderCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
