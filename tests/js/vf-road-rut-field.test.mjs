import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadRutFieldReference,
  realizeRoadRutCellsReference,
} from '../../web/vf-ui/vf-road-rut-field.mjs';
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

const RUT_IDENTITY = Object.freeze({
  ...WEAR_IDENTITY,
  channel: 'road-rut',
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
        [0, 35, 0],
        [0, 49, 0],
        [1, 64, 0],
        [0, 35, 1],
        [10, 35, 0],
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

test('bounded traffic ruts share depressed geometry and PBR wear', () => {
  const wear = roadWear();
  const realize = () => realizeRoadRutCellsReference(
    createRoadRutFieldReference(RUT_IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-rut-working-set:v1');
  assert.equal(workingSet.sampleCount, 4);
  assert.equal(workingSet.potentialCellCount, 300_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 144);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.rutIntensity,
    workingSet.material.rutIntensity,
  );
  assert.strictEqual(workingSet.geometry.rutDepth, workingSet.material.rutDepth);
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.continuityDriver), [
    -0.7325435280799866,
    -0.7393532395362854,
    -0.7347859144210815,
    -0.7325435280799866,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.rutIntensity), [
    0.6976138949394226,
    0,
    0.6962614059448242,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.rutDepth), [
    0.01892918534576893,
    0,
    0.018858959898352623,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.displacement), [
    -0.035488784313201904,
    -0.016560515388846397,
    -0.035383567214012146,
    -0.016559597104787827,
  ]);
  assert.deepEqual(Array.from(workingSet.material.roughness), [
    0.3559974431991577,
    0.5303807854652405,
    0.3569953441619873,
    0.5304009318351746,
  ]);
  assert.deepEqual(Array.from(workingSet.material.wetness), [
    0.6569014191627502,
    0.6076497435569763,
    0.6566749811172485,
    0.607631504535675,
  ]);

  assert.ok(workingSet.geometry.rutIntensity[0] > 0);
  assert.equal(workingSet.geometry.rutIntensity[1], 0);
  assert.ok(workingSet.geometry.rutIntensity[2] > 0);
  assert.equal(workingSet.geometry.rutIntensity[3], 0);
  assert.ok(
    workingSet.geometry.displacement[0] < wear.geometry.displacement[0],
  );
  assert.ok(
    workingSet.material.roughness[0] < wear.material.roughness[0],
  );
  assert.ok(workingSet.material.wetness[0] > wear.material.wetness[0]);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(9, 12)),
    Array.from(wear.material.albedo.subarray(9, 12)),
  );
});

test('road ruts reject forged wear state and unbounded demand', () => {
  const field = createRoadRutFieldReference(RUT_IDENTITY);
  assert.throws(
    () => realizeRoadRutCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadRutCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
