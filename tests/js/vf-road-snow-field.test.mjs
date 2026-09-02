import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadSnowFieldReference,
  realizeRoadSnowCellsReference,
} from '../../web/vf-ui/vf-road-snow-field.mjs';
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

const SNOW_IDENTITY = Object.freeze({
  ...WEAR_IDENTITY,
  channel: 'road-snow',
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

test('bounded road snow shares drift geometry and PBR coverage', () => {
  const wear = roadWear();
  const realize = () => realizeRoadSnowCellsReference(
    createRoadSnowFieldReference(SNOW_IDENTITY),
    wear,
    { sampleBudget: 4 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-snow-working-set:v1');
  assert.equal(workingSet.sampleCount, 4);
  assert.equal(workingSet.potentialCellCount, 300_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 128);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(
    workingSet.geometry.snowCoverage,
    workingSet.material.snowCoverage,
  );
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.driftDriver), [
    -0.5746227502822876,
    -0.4700985848903656,
    0.5306928753852844,
    -0.4700985848903656,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.snowCoverage), [
    0.326119601726532,
    0.5861172080039978,
    0.7474846839904785,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.snowDepth), [
    0.0026089567691087723,
    0.01154650840908289,
    0.01472544763237238,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.material.roughness), [
    0.6443984508514404,
    0.7354945540428162,
    0.7940561771392822,
    0.5308541655540466,
  ]);

  assert.ok(workingSet.geometry.snowCoverage[0] > 0);
  assert.ok(workingSet.geometry.snowCoverage[1] > 0);
  assert.ok(workingSet.geometry.snowCoverage[2] > 0);
  assert.equal(workingSet.geometry.snowCoverage[3], 0);
  assert.ok(workingSet.geometry.snowDepth[0] > 0);
  assert.ok(workingSet.geometry.snowDepth[1] > workingSet.geometry.snowDepth[0]);
  assert.ok(workingSet.material.albedo[0] > wear.material.albedo[0]);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(9, 12)),
    Array.from(wear.material.albedo.subarray(9, 12)),
  );
});

test('road snow rejects forged wear state and unbounded demand', () => {
  const field = createRoadSnowFieldReference(SNOW_IDENTITY);
  assert.throws(
    () => realizeRoadSnowCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadSnowCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
