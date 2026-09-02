import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadMarkingFieldReference,
  realizeRoadMarkingCellsReference,
} from '../../web/vf-ui/vf-road-marking-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-markings',
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
        [3, 49, 0],
        [0, 20, 0],
        [0, 49, 1],
        [6, 49, 0],
      ],
      cellBudget: 5,
    },
  );
  return realizeRoadWearCellsReference(
    createRoadWearFieldReference(IDENTITY),
    coordinates,
    { sampleBudget: 5 },
  );
}

test('bounded worn road markings share one geometry and PBR coverage', () => {
  const wear = roadWear();
  const realize = () => realizeRoadMarkingCellsReference(
    createRoadMarkingFieldReference(IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-marking-working-set:v1');
  assert.equal(workingSet.sampleCount, 4);
  assert.equal(workingSet.potentialCellCount, 300_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 128);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.paintCoverage,
    workingSet.material.paintCoverage,
  );
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.flakeDriver), [
    0.5652372241020203,
    -0.43310829997062683,
    0.5370505452156067,
    0.5652372241020203,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.paintCoverage), [
    0.7635580897331238,
    0,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.paintHeight), [
    0.0011453371262177825,
    0,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.material.roughness), [
    0.6021743416786194,
    0.6701287627220154,
    0.6725667119026184,
    0.6737834811210632,
  ]);

  assert.ok(workingSet.geometry.paintCoverage[0] > 0);
  assert.deepEqual(Array.from(workingSet.geometry.paintCoverage.subarray(1)), [0, 0, 0]);
  assert.ok(workingSet.geometry.paintHeight[0] > 0);
  assert.deepEqual(Array.from(workingSet.geometry.paintHeight.subarray(1)), [0, 0, 0]);
  assert.ok(workingSet.material.albedo[0] > wear.material.albedo[0]);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(3)),
    Array.from(wear.material.albedo.subarray(3, 12)),
  );
});

test('road markings reject forged wear state and unbounded demand', () => {
  const field = createRoadMarkingFieldReference(IDENTITY);
  assert.throws(
    () => realizeRoadMarkingCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadMarkingCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
