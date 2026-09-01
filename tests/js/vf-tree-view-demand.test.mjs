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
import {
  selectTreeViewDemandReference,
} from '../../web/vf-ui/vf-tree-view-demand.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

const CAMERA = Object.freeze({
  eye: Object.freeze([30, 50, 40]),
  target: Object.freeze([-32, 128, 14]),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportWidth: 1280,
  viewportHeight: 720,
  maximumDistance: 180,
});

function forestWorkingSet() {
  return realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    {
      patches: [[-2, 3], [-1, 3], [-2, 4], [-1, 4]],
      treeBudget: 128,
    },
  );
}

test('camera demand emits a bounded canonical request consumable by the tree planner', () => {
  const forest = forestWorkingSet();
  const demand = selectTreeViewDemandReference({
    camera: CAMERA,
    forest,
    treeBudget: 24,
    primitiveBudget: 256,
  });
  const recreated = selectTreeViewDemandReference({
    camera: { ...CAMERA },
    forest,
    treeBudget: 24,
    primitiveBudget: 256,
  });
  const plan = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    demand,
  );

  assert.equal(demand.kind, 'tree-view-demand:v1');
  assert.deepEqual(demand, recreated);
  assert.ok(demand.treeIndices instanceof Uint32Array);
  assert.ok(demand.detailLevels instanceof Uint8Array);
  assert.equal(demand.treeIndices.length, demand.detailLevels.length);
  assert.ok(demand.treeIndices.length > 0 && demand.treeIndices.length <= 24);
  assert.deepEqual(
    Array.from(demand.treeIndices),
    Array.from(demand.treeIndices).toSorted((left, right) => left - right),
  );
  assert.equal(new Set(demand.treeIndices).size, demand.treeIndices.length);
  assert.equal(plan.primitiveCount, demand.plannedPrimitiveCount);
  assert.ok(plan.primitiveCount <= 256);
  assert.equal(demand.scannedTreeCount, forest.treeCount);
  assert.ok(demand.visibleTreeCount >= demand.treeIndices.length);
});

test('view distance chooses stable coarse-to-fine levels without changing tree identities', () => {
  const forest = forestWorkingSet();
  const demandAt = (distance) => selectTreeViewDemandReference({
    camera: {
      ...CAMERA,
      eye: [30, 128 - distance, 35],
      target: [-32, 128, 14],
    },
    forest,
    treeBudget: 16,
    primitiveBudget: 352,
  });
  const far = demandAt(180);
  const near = demandAt(45);
  const farByTree = new Map(Array.from(far.treeIndices, (tree, index) => [
    tree,
    far.detailLevels[index],
  ]));
  const shared = Array.from(near.treeIndices).filter((tree) => farByTree.has(tree));

  assert.ok(shared.length > 0);
  assert.ok(shared.some((tree) => (
    near.detailLevels[Array.from(near.treeIndices).indexOf(tree)] > farByTree.get(tree)
  )));
  assert.ok(Math.max(...near.detailLevels) <= 2);
  assert.ok(Math.min(...far.detailLevels) >= 0);
});

test('primitive pressure keeps every selected tree coarse before adding detail', () => {
  const forest = forestWorkingSet();
  const demand = selectTreeViewDemandReference({
    camera: CAMERA,
    forest,
    treeBudget: 8,
    primitiveBudget: 24,
  });
  const empty = selectTreeViewDemandReference({
    camera: CAMERA,
    forest,
    treeBudget: 4096,
    primitiveBudget: 0,
  });

  assert.equal(demand.treeIndices.length, 8);
  assert.equal(demand.plannedPrimitiveCount, 24);
  assert.deepEqual(Array.from(demand.detailLevels).toSorted(), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(empty.treeIndices.length, 0);
  assert.equal(empty.detailLevels.length, 0);
  assert.equal(empty.plannedPrimitiveCount, 0);
  assert.throws(() => selectTreeViewDemandReference({
    camera: CAMERA,
    forest,
    treeBudget: 4097,
    primitiveBudget: 24,
  }), /treeBudget/);
  assert.throws(() => selectTreeViewDemandReference({
    camera: CAMERA,
    forest,
    treeBudget: 8,
    primitiveBudget: 65537,
  }), /primitiveBudget/);
});

test('far bounds cull trees without scanning or realizing another forest region', () => {
  const forest = forestWorkingSet();
  const demand = selectTreeViewDemandReference({
    camera: { ...CAMERA, maximumDistance: 20 },
    forest,
    treeBudget: 64,
    primitiveBudget: 1024,
  });

  assert.equal(demand.treeIndices.length, 0);
  assert.equal(demand.visibleTreeCount, 0);
  assert.equal(demand.scannedTreeCount, forest.treeCount);
  assert.equal(demand.culledTreeCount, forest.treeCount);
});
