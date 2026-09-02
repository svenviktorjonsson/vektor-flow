import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadDirtFieldReference,
  realizeRoadDirtCellsReference,
} from '../../web/vf-ui/vf-road-dirt-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const WEAR_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x3c6ef372, 0xa54ff53a]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-wear',
});

const DIRT_IDENTITY = Object.freeze({
  ...WEAR_IDENTITY,
  channel: 'road-dirt',
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

test('bounded road dirt shares deposited geometry and PBR accumulation', () => {
  const wear = roadWear();
  const realize = () => realizeRoadDirtCellsReference(
    createRoadDirtFieldReference(DIRT_IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-dirt-working-set:v1');
  assert.equal(workingSet.sampleCount, 4);
  assert.equal(workingSet.potentialCellCount, 300_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 128);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.dirtAccumulation,
    workingSet.material.dirtAccumulation,
  );
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );

  assert.deepEqual(Array.from(workingSet.debrisDriver), [
    0.06500603258609772,
    -0.3647356629371643,
    0.2312675416469574,
    -0.3647356629371643,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.dirtAccumulation), [
    0,
    0.5272319912910461,
    0.6487616896629333,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.depositHeight), [
    0,
    0.0015816959785297513,
    0.0019462850177660584,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.material.roughness), [
    0.7195504307746887,
    0.8524585366249084,
    0.8874264359474182,
    0.7102240324020386,
  ]);
  assert.ok(workingSet.geometry.dirtAccumulation[1] > 0);
  assert.ok(workingSet.geometry.dirtAccumulation[2] > 0);
  assert.ok(workingSet.geometry.depositHeight[1] > 0);
  assert.ok(workingSet.geometry.depositHeight[2] > 0);
  assert.equal(workingSet.geometry.depositHeight[0], 0);
  assert.equal(workingSet.geometry.depositHeight[3], 0);
  assert.ok(workingSet.material.albedo[3] < wear.material.albedo[3]);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(0, 3)),
    Array.from(wear.material.albedo.subarray(0, 3)),
  );
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(9, 12)),
    Array.from(wear.material.albedo.subarray(9, 12)),
  );
});

test('road dirt rejects forged wear state and unbounded demand', () => {
  const field = createRoadDirtFieldReference(DIRT_IDENTITY);
  assert.throws(
    () => realizeRoadDirtCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadDirtCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
