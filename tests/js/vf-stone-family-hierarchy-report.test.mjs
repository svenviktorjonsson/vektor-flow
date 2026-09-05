import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStoneFamilyPopulationReference,
  realizeStoneFamilyPatchesReference,
} from '../../web/vf-ui/vf-stone-family-population.mjs';
import {
  measureStoneFamilyHierarchyReference,
} from '../../web/vf-ui/vf-stone-family-hierarchy-report.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x510e527f, 0x9b05688c]),
  domain: 'material',
  hierarchy: Object.freeze(['world:highland', 'stone-field:north']),
  lod: 0,
  channel: 'population',
});

const PATCHES = Object.freeze(Array.from({ length: 16 }, (_, index) => (
  Object.freeze([index % 4 - 2, Math.floor(index / 4) - 2])
)));

function report(patches) {
  const workingSet = realizeStoneFamilyPatchesReference(
    createStoneFamilyPopulationReference(IDENTITY),
    { patches, stoneBudget: 512 },
  );
  return measureStoneFamilyHierarchyReference(workingSet);
}

test('stone report pins patch-conditioned family clustering', () => {
  const forward = report(PATCHES);
  const reversed = report([...PATCHES].reverse());

  assert.deepEqual(reversed, forward);
  assert.equal(forward.kind, 'stone-family-hierarchy-report:v1');
  assert.equal(forward.stoneCount, 231);
  assert.equal(forward.patchCount, 16);
  assert.equal(forward.familyCount, 4);
  assert.equal(forward.dominantMatchCount, 206);
  assert.equal(forward.dominantAffinity, 0.8917748917748918);
  assert.ok(forward.dominantAffinity > 0.8);
  assert.deepEqual(Array.from(forward.familyCounts), [97, 52, 27, 55]);
  assert.deepEqual(Array.from(forward.patchDominantFamilies), [
    0, 1, 0, 3, 3, 0, 2, 1,
    1, 1, 3, 0, 0, 0, 0, 2,
  ]);
  assert.deepEqual(Array.from(forward.patchSampleCounts), [
    16, 14, 15, 15, 15, 15, 13, 14,
    11, 15, 16, 15, 14, 13, 15, 15,
  ]);
  assert.deepEqual(Array.from(forward.patchMatchCounts), [
    14, 12, 12, 14, 13, 13, 12, 12,
    9, 13, 16, 15, 14, 13, 13, 11,
  ]);
  assert.equal(forward.vectorBytes, 208);
});
