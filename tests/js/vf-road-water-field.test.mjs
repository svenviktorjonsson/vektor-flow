import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadWaterFieldReference,
  realizeRoadWaterCellsReference,
} from '../../web/vf-ui/vf-road-water-field.mjs';
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

const WATER_IDENTITY = Object.freeze({
  ...WEAR_IDENTITY,
  channel: 'road-water',
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

test('bounded road water shares pooled geometry and PBR truth', () => {
  const wear = roadWear();
  const realize = () => realizeRoadWaterCellsReference(
    createRoadWaterFieldReference(WATER_IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-water-working-set:v1');
  assert.equal(workingSet.sampleCount, 4);
  assert.equal(workingSet.potentialCellCount, 300_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 128);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.waterCoverage,
    workingSet.material.waterCoverage,
  );
  assert.strictEqual(
    workingSet.geometry.waterDepth,
    workingSet.material.waterDepth,
  );
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.poolingDriver), [
    0.7781274914741516,
    0.9203979969024658,
    -0.6807713508605957,
    0.9203979969024658,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.waterCoverage), [
    0.7009357810020447,
    0,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.waterDepth), [
    0.004998494870960712,
    0,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.material.roughness), [
    0.18665534257888794,
    0.5308541655540466,
    0.5396491289138794,
    0.5308541655540466,
  ]);
  assert.deepEqual(Array.from(workingSet.material.wetness), [
    0.8826620578765869,
    0.60716712474823,
    0.6055241823196411,
    0.60716712474823,
  ]);

  assert.ok(workingSet.geometry.waterCoverage[0] > 0);
  assert.ok(workingSet.geometry.waterCoverage[1] >= 0);
  assert.ok(workingSet.geometry.waterCoverage[2] >= 0);
  assert.equal(workingSet.geometry.waterCoverage[3], 0);
  assert.ok(workingSet.geometry.waterDepth[0] > 0);
  assert.equal(workingSet.geometry.waterDepth[3], 0);
  assert.ok(workingSet.material.wetness[0] > wear.material.wetness[0]);
  assert.ok(workingSet.material.roughness[0] < wear.material.roughness[0]);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(9, 12)),
    Array.from(wear.material.albedo.subarray(9, 12)),
  );
});

test('road water rejects forged wear state and unbounded demand', () => {
  const field = createRoadWaterFieldReference(WATER_IDENTITY);
  assert.throws(
    () => realizeRoadWaterCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadWaterCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
