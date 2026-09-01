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

test('conditioned branch hierarchy matches pinned transforms and parents', () => {
  const forest = forestWorkingSet();
  const plan = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 64 },
  );

  assert.deepEqual(Array.from(plan.kinds), [
    0, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  ]);
  assert.deepEqual(Array.from(plan.parents), [
    -1, -1, 0, 0, 0, 0,
    2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5,
  ]);
  assert.deepEqual(Array.from(plan.transforms.slice(16, 24)), [
    -35.81911849975586,
    124.33760070800781,
    29.197364807128906,
    0.8161920309066772,
    0.34334349632263184,
    0.46469971537590027,
    3.3826026916503906,
    0.036419548094272614,
  ]);
  assert.match(plan.primitiveIds[0], /:trunk$/);
  assert.match(plan.primitiveIds[2], /:branch:0$/);
  assert.match(plan.primitiveIds[6], /:branch:0:foliage:0$/);
});

test('bounded planning serves every tree coarse geometry before fine detail', () => {
  const forest = forestWorkingSet();
  const planner = createTreeGeometryPlannerReference(IDENTITY);
  const forward = planTreeGeometryReference(planner, forest, {
    treeIndices: [1, 0, 0],
    detailLevels: [2, 1, 2],
    primitiveBudget: 5,
  });
  const reversed = planTreeGeometryReference(planner, forest, {
    treeIndices: new Uint32Array([0, 1]),
    detailLevels: new Uint8Array([2, 2]),
    primitiveBudget: 5,
  });
  const recreated = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0, 1], detailLevels: [2, 2], primitiveBudget: 5 },
  );
  const empty = planTreeGeometryReference(planner, forest, {
    treeIndices: [forest.treeCount - 1],
    detailLevels: [2],
    primitiveBudget: 0,
  });

  assert.deepEqual(Array.from(forward.kinds), [0, 1, 0, 1, 2]);
  assert.deepEqual(Array.from(forward.owners), [0, 0, 1, 1, 0]);
  assert.deepEqual(Array.from(forward.parents), [-1, -1, -1, -1, 0]);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(recreated, forward);
  assert.equal(forward.vectorBytes, 210);
  assert.equal(empty.primitiveCount, 0);
  assert.equal(empty.vectorBytes, 0);
  assert.equal(empty.trees.length, 0);
  assert.throws(
    () => planTreeGeometryReference(planner, forest, {
      treeIndices: Array.from({ length: 4097 }, () => 0),
      detailLevels: Array.from({ length: 4097 }, () => 0),
      primitiveBudget: 0,
    }),
    /at most 4096 indices/,
  );
  assert.throws(
    () => planTreeGeometryReference(planner, forest, {
      treeIndices: [0], detailLevels: [0], primitiveBudget: 65537,
    }),
    /primitive budget exceeds 65536/,
  );
});
