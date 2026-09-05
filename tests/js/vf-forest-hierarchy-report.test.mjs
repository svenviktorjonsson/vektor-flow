import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from '../../web/vf-ui/vf-forest-population.mjs';
import {
  measureForestHeightHierarchyReference,
} from '../../web/vf-ui/vf-forest-hierarchy-report.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

const PATCHES = Object.freeze(Array.from({ length: 16 }, (_, index) => (
  Object.freeze([index % 4 - 2, Math.floor(index / 4) - 2])
)));

function report(patches) {
  const workingSet = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches, treeBudget: 512 },
  );
  return measureForestHeightHierarchyReference(workingSet);
}

test('forest report pins species-conditioned height variation', () => {
  const forward = report(PATCHES);
  const reversed = report([...PATCHES].reverse());

  assert.deepEqual(reversed, forward);
  assert.equal(forward.kind, 'forest-height-hierarchy-report:v1');
  assert.equal(forward.treeCount, 343);
  assert.equal(forward.speciesCount, 5);
  assert.deepEqual(Array.from(forward.speciesIndices), [0, 1, 2, 3, 4]);
  assert.deepEqual(Array.from(forward.sampleCounts), [134, 90, 62, 38, 19]);
  assert.deepEqual(Array.from(forward.meanHeights), [
    26.97306980303864,
    29.671465894911023,
    25.997006200974987,
    13.567421762566818,
    18.752784879584063,
  ]);
  assert.equal(forward.globalMean, 25.564147546061967);
  assert.equal(forward.totalSumSquares, 13736.341618799572);
  assert.equal(forward.withinSpeciesSumSquares, 5589.907940820822);
  assert.equal(forward.betweenSpeciesSumSquares, 8146.433677978742);
  assert.equal(forward.explainedFraction, 0.5930570092133938);
  assert.ok(forward.explainedFraction > 0.5);
  assert.ok(Math.abs(
    forward.totalSumSquares
      - forward.withinSpeciesSumSquares
      - forward.betweenSpeciesSumSquares,
  ) < 1e-9);
  assert.equal(forward.vectorBytes, 80);
});
