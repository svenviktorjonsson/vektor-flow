import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadConstructionFieldReference,
  realizeRoadConstructionCellsReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0xbb67ae85, 0x84caa73b]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road-construction',
});

function roadCoordinates() {
  return realizeRoadCoordinateCellsReference(createRoadCoordinateFieldReference({
    origin: [10, 20, 3],
    forward: [1, 0, 0],
    up: [0, 0, 1],
    cellSize: [4, 2],
    longitudinalCells: 1_000_000_000,
    lateralCells: 4,
    layerThicknesses: [1, 2, 4],
  }), {
    cells: [
      [3, 1, 0],
      [3, 1, 1],
      [3, 1, 2],
      [7, 2, 0],
    ],
    cellBudget: 4,
  });
}

test('bounded road construction shares layered composition, geometry, and PBR truth', () => {
  const coordinates = roadCoordinates();
  const realize = () => realizeRoadConstructionCellsReference(
    createRoadConstructionFieldReference(IDENTITY),
    coordinates,
    { sampleBudget: 3 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-construction-working-set:v1');
  assert.equal(workingSet.sampleCount, 3);
  assert.equal(workingSet.potentialCellCount, 12_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 120);
  assert.deepEqual(workingSet, realize());
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    coordinates.geometry.coordinates.buffer,
  );
  assert.deepEqual(Array.from(workingSet.geometry.layerIndices), [0, 1, 2]);
  assert.deepEqual(Array.from(workingSet.drivers), [
    -0.8621248006820679, -0.38026678562164307,
    -0.8621248006820679, -0.38026678562164307,
    -0.8621248006820679, -0.38026678562164307,
  ]);
  assert.deepEqual(Array.from(workingSet.material.aggregateFraction), [
    0.5584468841552734,
    0.6984468698501587,
    0.7984468936920166,
  ]);
  assert.deepEqual(Array.from(workingSet.material.binderFraction), [
    0.33429598808288574,
    0.17429599165916443,
    0.0742959976196289,
  ]);
  assert.deepEqual(Array.from(workingSet.material.roughness), [
    0.7569230198860168,
    0.85692298412323,
    0.9169229865074158,
  ]);

  for (let sample = 0; sample < workingSet.sampleCount; sample += 1) {
    const aggregate = workingSet.material.aggregateFraction[sample];
    const binder = workingSet.material.binderFraction[sample];
    const voids = workingSet.material.voidFraction[sample];
    assert.ok(aggregate >= 0 && aggregate <= 1);
    assert.ok(binder >= 0 && binder <= 1);
    assert.ok(voids >= 0 && voids <= 1);
    assert.ok(Math.abs(aggregate + binder + voids - 1) < 1e-6);
    assert.ok(Number.isFinite(workingSet.geometry.displacement[sample]));
    assert.ok(workingSet.material.roughness[sample] >= 0);
    assert.ok(workingSet.material.roughness[sample] <= 1);
  }

  assert.ok(
    workingSet.material.aggregateFraction[0]
      < workingSet.material.aggregateFraction[1],
  );
  assert.ok(
    workingSet.material.aggregateFraction[1]
      < workingSet.material.aggregateFraction[2],
  );
  assert.ok(
    workingSet.material.binderFraction[0]
      > workingSet.material.binderFraction[1],
  );
  assert.ok(
    workingSet.material.binderFraction[1]
      > workingSet.material.binderFraction[2],
  );
});

test('road construction rejects forged coordinates and unbounded demand', () => {
  const field = createRoadConstructionFieldReference(IDENTITY);
  assert.throws(
    () => realizeRoadConstructionCellsReference(
      field,
      { kind: 'road-coordinate-working-set:v1' },
      { sampleBudget: 1 },
    ),
    /road coordinate working set is required/,
  );
  assert.throws(
    () => realizeRoadConstructionCellsReference(
      field,
      roadCoordinates(),
      { sampleBudget: 65_537 },
    ),
    /sampleBudget must be an integer from 0 to 65536/,
  );
});
