import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoadCoordinateFieldReference,
  realizeRoadCoordinateCellsReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  createRoadWearFieldReference,
  realizeRoadWearCellsReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x3c6ef372, 0xa54ff53a]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road',
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
      [4, 1, 0],
      [7, 2, 1],
    ],
    cellBudget: 3,
  });
}

test('correlated road wear drives bounded geometry and PBR from shared coordinates', () => {
  const coordinates = roadCoordinates();
  const realize = () => realizeRoadWearCellsReference(
    createRoadWearFieldReference(IDENTITY),
    coordinates,
    { sampleBudget: 2 },
  );
  const workingSet = realize();

  assert.equal(workingSet.kind, 'road-wear-working-set:v1');
  assert.equal(workingSet.sampleCount, 2);
  assert.equal(workingSet.potentialCellCount, 12_000_000_000);
  assert.equal(workingSet.truncated, true);
  assert.equal(workingSet.vectorBytes, 64);
  assert.strictEqual(workingSet.geometry.coordinates, workingSet.material.coordinates);
  assert.strictEqual(
    workingSet.geometry.coordinates.buffer,
    coordinates.geometry.coordinates.buffer,
  );
  assert.deepEqual(workingSet, realize());

  for (let sample = 0; sample < workingSet.sampleCount; sample += 1) {
    const traffic = workingSet.drivers[sample * 2];
    const exposure = workingSet.drivers[sample * 2 + 1];
    const wear = Math.min(1, Math.max(0, 0.5 + traffic * 0.35 + exposure * 0.15));
    const wetness = Math.min(1, Math.max(0, 0.45 - exposure * 0.3 + wear * 0.1));
    const colorScale = (1 - wear * 0.18) * (1 - wetness * 0.25);
    const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6);

    close(workingSet.geometry.displacement[sample], -0.025 * wear);
    close(workingSet.material.wetness[sample], wetness);
    close(workingSet.material.roughness[sample], 0.95 - wear * 0.45 - wetness * 0.2);
    close(workingSet.material.albedo[sample * 3], 0.12 * colorScale);
    close(workingSet.material.albedo[sample * 3 + 1], 0.115 * colorScale);
    close(workingSet.material.albedo[sample * 3 + 2], 0.11 * colorScale);
  }
  assert.notEqual(workingSet.drivers[0], workingSet.drivers[2]);
});
