import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from '../../web/vf-ui/vf-forest-population.mjs';
import {
  createTreeGeometryPlannerReference,
  planTreeGeometryReference,
} from '../../web/vf-ui/vf-tree-geometry-plan.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function forestWorkingSet() {
  return realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
}

test('tree geometry appends demanded branches and foliage to stable coarse identities', () => {
  const forest = forestWorkingSet();
  const planner = createTreeGeometryPlannerReference(IDENTITY);
  const coarse = planTreeGeometryReference(planner, forest, {
    treeIndices: [0],
    detailLevels: [0],
    primitiveBudget: 64,
  });
  const refined = planTreeGeometryReference(planner, forest, {
    treeIndices: new Uint32Array([0]),
    detailLevels: new Uint8Array([2]),
    primitiveBudget: 64,
  });

  assert.equal(coarse.kind, 'tree-geometry-plan:v1');
  assert.equal(coarse.primitiveCount, 2);
  assert.equal(refined.primitiveCount, 22);
  assert.deepEqual(Array.from(coarse.kinds), [0, 1]);
  assert.deepEqual(Array.from(coarse.levels), [0, 0]);
  assert.deepEqual(Array.from(coarse.parents), [-1, -1]);
  assert.deepEqual(refined.primitiveIds.slice(0, 2), coarse.primitiveIds);
  assert.deepEqual(
    Array.from(refined.transforms.slice(0, 16)),
    Array.from(coarse.transforms),
  );
  assert.strictEqual(refined.trees[0].primitives[0], coarse.trees[0].primitives[0]);
  assert.strictEqual(refined.trees[0].primitives[1], coarse.trees[0].primitives[1]);
  assert.equal(coarse.vectorBytes, 84);
  assert.equal(refined.vectorBytes, 924);
  assert.ok(coarse.kinds instanceof Uint8Array);
  assert.ok(coarse.levels instanceof Uint8Array);
  assert.ok(coarse.owners instanceof Uint32Array);
  assert.ok(coarse.parents instanceof Int32Array);
  assert.ok(coarse.transforms instanceof Float32Array);
});
