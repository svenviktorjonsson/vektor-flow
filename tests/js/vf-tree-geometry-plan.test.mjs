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

function transformAt(plan, index) {
  return Array.from(plan.transforms.subarray(index * 8, index * 8 + 8));
}

function distance(left, right) {
  return Math.hypot(...left.map((value, axis) => value - right[axis]));
}

test('tree geometry appends demanded branches and foliage to stable coarse identities', () => {
  const forest = forestWorkingSet();
  const planner = createTreeGeometryPlannerReference(IDENTITY);
  const coarse = planTreeGeometryReference(planner, forest, {
    treeIndices: [0],
    detailLevels: [0],
    primitiveBudget: 128,
  });
  const refined = planTreeGeometryReference(planner, forest, {
    treeIndices: new Uint32Array([0]),
    detailLevels: new Uint8Array([2]),
    primitiveBudget: 128,
  });

  assert.equal(coarse.kind, 'tree-geometry-plan:v1');
  assert.equal(coarse.primitiveCount, 2);
  assert.ok(refined.primitiveCount >= 68 && refined.primitiveCount <= 128);
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
  assert.equal(refined.vectorBytes, refined.primitiveCount * 42);
  assert.ok(coarse.kinds instanceof Uint8Array);
  assert.ok(coarse.levels instanceof Uint8Array);
  assert.ok(coarse.owners instanceof Uint32Array);
  assert.ok(coarse.parents instanceof Int32Array);
  assert.ok(coarse.transforms instanceof Float32Array);
});

test('conditioned recursive branches retain parents, taper, and bounded attachment', () => {
  const forest = forestWorkingSet();
  const plan = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 128 },
  );

  assert.ok(plan.primitiveCount >= 68 && plan.primitiveCount <= 128);
  assert.deepEqual(Array.from(plan.kinds.slice(0, 8)), [0, 1, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(Array.from(plan.levels.slice(0, 8)), [0, 0, 1, 1, 1, 1, 1, 1]);
  assert.equal(Array.from(plan.kinds).filter((kind) => kind === 2).length, 18);
  const twigCount = Array.from(plan.kinds).filter((kind) => kind === 4).length;
  assert.ok(twigCount >= 24 && twigCount <= 54);
  assert.equal(Array.from(plan.kinds).filter((kind) => kind === 3).length, twigCount);
  assert.equal(plan.primitiveCount, 20 + twigCount * 2);
  assert.ok(Array.from(plan.transforms).every(Number.isFinite));

  for (let index = 2; index < plan.primitiveCount; index += 1) {
    const kind = plan.kinds[index];
    const parentIndex = plan.parents[index];
    assert.ok(parentIndex >= 0 && parentIndex < index);
    const transform = transformAt(plan, index);
    assert.ok(transform[6] > 0 && transform[7] > 0);
    assert.ok(Math.abs(Math.hypot(...transform.slice(3, 6)) - 1) < 1e-5);
    if (kind === 2 || kind === 4) {
      assert.equal(plan.kinds[parentIndex] === 0 || plan.kinds[parentIndex] === 2, true);
      const parent = transformAt(plan, parentIndex);
      assert.ok(transform[7] < parent[7]);
      assert.ok(transform[5] >= 0.08 && transform[5] <= 0.98);
      const parentStart = plan.kinds[parentIndex] === 0
        ? parent.slice(0, 3).map((value, axis) => value - parent[axis + 3] * parent[6] * 0.5)
        : parent.slice(0, 3);
      const offset = transform.slice(0, 3).map((value, axis) => value - parentStart[axis]);
      const along = offset.reduce((sum, value, axis) => sum + value * parent[axis + 3], 0);
      const attachment = parentStart.map((value, axis) => value + parent[axis + 3] * along);
      assert.ok(along >= parent[6] * 0.25 && along <= parent[6] * 0.95);
      assert.ok(distance(transform.slice(0, 3), attachment) < 1e-4);
    } else {
      assert.equal(kind, 3);
      assert.equal(plan.kinds[parentIndex], 4);
    }
  }
  assert.match(plan.primitiveIds[0], /:trunk$/);
  assert.match(plan.primitiveIds[2], /:branch:g0:0$/);
  assert.ok(plan.primitiveIds.some((id) => /:branch:g0:\d+:g1:\d+:twig:\d+$/u.test(id)));
  assert.ok(plan.primitiveIds.some((id) => /:foliage$/u.test(id)));
});

test('recursive tree geometry replays byte-identically and varies by seed', () => {
  const forest = forestWorkingSet();
  const first = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 128 },
  );
  const replay = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 128 },
  );
  const alternateIdentity = Object.freeze({
    ...IDENTITY,
    seed: Object.freeze([IDENTITY.seed[0], (IDENTITY.seed[1] ^ 0x9e3779b9) >>> 0]),
  });
  const alternate = planTreeGeometryReference(
    createTreeGeometryPlannerReference(alternateIdentity),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 128 },
  );

  assert.deepEqual(replay, first);
  assert.notDeepEqual(Array.from(alternate.transforms.slice(16)), Array.from(first.transforms.slice(16)));
  let maxBranchDepth = 0;
  for (let index = 0; index < first.primitiveCount; index += 1) {
    let depth = 0;
    let parent = first.parents[index];
    while (parent >= 0) {
      depth += 1;
      parent = first.parents[parent];
      assert.ok(depth <= 4);
    }
    if (first.kinds[index] === 2 || first.kinds[index] === 4) {
      maxBranchDepth = Math.max(maxBranchDepth, depth);
    }
  }
  assert.equal(maxBranchDepth, 3);
  assert.equal(first.vectorBytes, first.primitiveCount * 42);
});

test('twig emergence rises toward thin branches and leaves attach only to terminal twigs', () => {
  const forest = forestWorkingSet();
  const treeIndices = Array.from({ length: forest.treeCount }, (_, index) => index);
  const plan = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices, detailLevels: treeIndices.map(() => 2), primitiveBudget: 4096 },
  );
  const twigChildren = new Uint32Array(plan.primitiveCount);
  const leafChildren = new Uint32Array(plan.primitiveCount);
  for (let index = 0; index < plan.primitiveCount; index += 1) {
    const parent = plan.parents[index];
    if (plan.kinds[index] === 4) {
      assert.equal(plan.kinds[parent], 2);
      twigChildren[parent] += 1;
    } else if (plan.kinds[index] === 3) {
      assert.equal(plan.kinds[parent], 4);
      leafChildren[parent] += 1;
    }
  }
  let thickParents = 0;
  let thickTwigs = 0;
  let thinParents = 0;
  let thinTwigs = 0;
  const trunkRadiusByOwner = new Map();
  for (let index = 0; index < plan.primitiveCount; index += 1) {
    if (plan.kinds[index] === 0) {
      trunkRadiusByOwner.set(plan.owners[index], transformAt(plan, index)[7]);
    }
  }
  for (let index = 0; index < plan.primitiveCount; index += 1) {
    if (plan.kinds[index] === 0) assert.equal(twigChildren[index], 0);
    if (plan.kinds[index] === 4) {
      assert.equal(twigChildren[index], 0);
      assert.equal(leafChildren[index], 1);
    }
    if (plan.kinds[index] !== 2) continue;
    const ratio = transformAt(plan, index)[7] / trunkRadiusByOwner.get(plan.owners[index]);
    if (ratio >= 0.34) {
      thickParents += 1;
      thickTwigs += twigChildren[index];
    } else {
      thinParents += 1;
      thinTwigs += twigChildren[index];
    }
  }
  assert.ok(thickParents > 0 && thinParents > 0);
  assert.ok(thinTwigs / thinParents > thickTwigs / thickParents);
  assert.ok(plan.primitiveCount <= forest.treeCount * 128);
  assert.equal(plan.vectorBytes, plan.primitiveCount * 42);
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
