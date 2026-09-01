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
