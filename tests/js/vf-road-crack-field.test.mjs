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
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x510e527f, 0x9b05688c]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-cracks',
});

function roadWear() {
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
  return realizeRoadWearCellsReference(
    createRoadWearFieldReference(IDENTITY),
    coordinates,
    { sampleBudget: 4 },
  );
}

test('bounded cracks drive one shared road geometry and PBR truth', () => {
  const wear = roadWear();
  const realize = () => realizeRoadCrackCellsReference(
    createRoadCrackFieldReference(IDENTITY),
    wear,
    { sampleBudget: 3 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-crack-working-set:v1');
  assert.equal(workingSet.sampleCount, 3);
  assert.equal(workingSet.potentialCellCount, 12_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 108);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    wear.geometry.coordinates.buffer,
  );
  assert.strictEqual(
    workingSet.geometry.crackCoverage,
    workingSet.material.crackCoverage,
  );
  assert.deepEqual(Array.from(workingSet.crackDriver), [
    0.17770405113697052,
    -0.7959567904472351,
    -0.5489493012428284,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.crackCoverage), [
    0.46145665645599365,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.aperture), [
    0.0018458266276866198,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.geometry.displacement), [
    -0.0013843700289726257,
    0,
    0,
  ]);
  assert.deepEqual(Array.from(workingSet.material.wetness), [
    0.40393099188804626,
    0.31790220737457275,
    0.3971887528896332,
  ]);

  for (let sample = 0; sample < workingSet.sampleCount; sample += 1) {
    const coverage = workingSet.geometry.crackCoverage[sample];
    assert.ok(coverage >= 0 && coverage <= 1);
    assert.ok(workingSet.geometry.aperture[sample] >= 0);
    assert.ok(workingSet.geometry.displacement[sample] <= 0);
    assert.ok(workingSet.material.roughness[sample] >= 0);
    assert.ok(workingSet.material.roughness[sample] <= 1);
    assert.ok(workingSet.material.wetness[sample] >= 0);
    assert.ok(workingSet.material.wetness[sample] <= 1);
  }

  assert.ok(workingSet.geometry.crackCoverage[0] > 0);
  assert.ok(
    workingSet.geometry.crackCoverage[0]
      > workingSet.geometry.crackCoverage[1],
  );
  assert.equal(workingSet.geometry.crackCoverage[2], 0);
  assert.equal(workingSet.geometry.aperture[2], 0);
  assert.equal(workingSet.geometry.displacement[2], 0);
  assert.deepEqual(
    Array.from(workingSet.material.albedo.subarray(6, 9)),
    Array.from(wear.material.albedo.subarray(6, 9)),
  );
});

test('road cracks reject forged wear state and unbounded demand', () => {
  const field = createRoadCrackFieldReference(IDENTITY);
  assert.throws(
    () => realizeRoadCrackCellsReference(
      field,
      { kind: 'road-wear-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road wear working set is required/,
  );
  assert.throws(
    () => realizeRoadCrackCellsReference(
      field,
      roadWear(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
