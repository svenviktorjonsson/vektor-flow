import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from '../../web/vf-ui/vf-forest-population.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

test('one demanded forest patch lazily realizes packed species and growth vectors', () => {
  const forest = createForestPopulationReference(IDENTITY);
  const first = realizeForestPatchesReference(forest, {
    patches: [[-2, 3]],
    treeBudget: 32,
  });
  const repeated = realizeForestPatchesReference(forest, {
    patches: [new Int32Array([-2, 3])],
    treeBudget: 32,
  });

  assert.equal(first.kind, 'forest-patch-working-set:v1');
  assert.equal(first.demandedPatchCount, 1);
  assert.ok(first.treeCount > 0 && first.treeCount <= 32);
  assert.ok(first.positions instanceof Float32Array);
  assert.ok(first.growth instanceof Float32Array);
  assert.ok(first.rotations instanceof Float32Array);
  assert.ok(first.speciesIndices instanceof Uint32Array);
  assert.equal(first.positions.length, first.treeCount * 3);
  assert.equal(first.growth.length, first.treeCount * 4);
  assert.equal(first.rotations.length, first.treeCount);
  assert.equal(first.speciesIndices.length, first.treeCount);
  assert.strictEqual(repeated.patches[0], first.patches[0]);
  assert.deepEqual(repeated, first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.patches));
});

test('species affinity and individual growth match a pinned forest patch', () => {
  const working = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );

  assert.equal(working.treeCount, 31);
  assert.equal(working.vectorBytes, 1116);
  assert.equal(working.patches[0].dominantSpecies, 1);
  assert.deepEqual(Array.from(working.speciesIndices), [
    1, 1, 1, 1, 1, 1, 1, 0, 2, 1, 4, 2, 0, 1, 0, 0,
    1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  ]);
  assert.deepEqual(Array.from(working.positions.slice(0, 6)), [
    -35.81911849975586,
    124.33760070800781,
    0,
    -46.61162567138672,
    100.48876190185547,
    0,
  ]);
  assert.deepEqual(Array.from(working.growth.slice(0, 8)), [
    0.2778277099132538,
    35.113807678222656,
    4.00105619430542,
    9.85130786895752,
    0.3378499448299408,
    33.8768310546875,
    4.321210861206055,
    9.504270553588867,
  ]);
  assert.deepEqual(working.species.map(({ id }) => id), [
    'tree:species:0',
    'tree:species:1',
    'tree:species:2',
    'tree:species:4',
  ]);
  assert.equal(working.species.find(({ index }) => index === 1).patchAffinity, 0.88);
  assert.equal(
    Array.from(working.speciesIndices).filter((species) => species === 1).length,
    23,
  );
});

test('forest patch demand is order independent, distant, and hard bounded', () => {
  const forest = createForestPopulationReference(IDENTITY);
  const forward = realizeForestPatchesReference(forest, {
    patches: [[-2, 3], [-1, 4], [-2, 3]],
    treeBudget: 43,
  });
  const reversed = realizeForestPatchesReference(forest, {
    patches: [[-1, 4], [-2, 3]],
    treeBudget: 43,
  });
  const recreated = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-1, 4], [-2, 3]], treeBudget: 43 },
  );
  const emptyDistant = realizeForestPatchesReference(forest, {
    patches: [[1_000_000_000, -1_000_000_000]],
    treeBudget: 0,
  });
  const boundedDistant = realizeForestPatchesReference(forest, {
    patches: [[1_000_000_000, -1_000_000_000]],
    treeBudget: 7,
  });

  assert.deepEqual(reversed, forward);
  assert.deepEqual(recreated, forward);
  assert.strictEqual(reversed.patches[0], forward.patches[0]);
  assert.equal(emptyDistant.treeCount, 0);
  assert.equal(emptyDistant.patches.length, 0);
  assert.equal(emptyDistant.vectorBytes, 0);
  assert.equal(boundedDistant.treeCount, 7);
  assert.equal(boundedDistant.vectorBytes, 252);
  assert.equal(boundedDistant.patches.length, 1);
  assert.throws(
    () => realizeForestPatchesReference(forest, {
      patches: Array.from({ length: 2049 }, () => [0, 0]),
      treeBudget: 0,
    }),
    /exceeds 2048 patches/,
  );
  assert.throws(
    () => realizeForestPatchesReference(forest, {
      patches: [[0, 0]],
      treeBudget: 65537,
    }),
    /tree budget exceeds 65536/,
  );
});
