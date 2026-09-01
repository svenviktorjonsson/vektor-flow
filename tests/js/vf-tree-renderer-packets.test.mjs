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
  createTreeMaterialFieldReference,
  realizeTreeMaterialsReference,
} from '../../web/vf-ui/vf-tree-material-field.mjs';
import {
  adaptTreeWorkingSetsToRetainedPacketsReference,
} from '../../web/vf-ui/vf-tree-renderer-packets.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function fullTreeWorkingSets() {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 64 },
  );
  const materials = realizeTreeMaterialsReference(
    createTreeMaterialFieldReference(IDENTITY),
    forest,
    geometry,
    { materialBudget: 64 },
  );
  return { geometry, materials };
}

test('tree renderer adapter batches aligned geometry and materials with zero steady upload', () => {
  const { geometry, materials } = fullTreeWorkingSets();
  const first = adaptTreeWorkingSetsToRetainedPacketsReference(geometry, materials);

  assert.equal(first.kind, 'tree-render-packet-state:v1');
  assert.equal(first.packets.length, 1);
  assert.equal(first.packets[0].kind, 'tree-render-packet:v1');
  assert.equal(first.packets[0].treeId, geometry.trees[0].id);
  assert.equal(first.packets[0].primitiveCount, 22);
  assert.deepEqual(first.packets[0].primitiveIds, geometry.primitiveIds);
  assert.deepEqual(Array.from(first.packets[0].primitiveKinds), Array.from(geometry.kinds));
  assert.deepEqual(Array.from(first.packets[0].materialKinds), Array.from(materials.materialKinds));
  assert.deepEqual(Array.from(first.packets[0].transforms), Array.from(geometry.transforms));
  assert.deepEqual(Array.from(first.packets[0].baseColors), Array.from(materials.baseColors));
  assert.deepEqual(Array.from(first.packets[0].surfaceParams), Array.from(materials.surfaceParams));
  assert.deepEqual(Array.from(first.packets[0].parents), Array.from(geometry.parents));
  assert.equal(first.packets[0].vectorBytes, 22 * 71);
  assert.deepEqual(first.delta.upload, { packets: 1, primitives: 22, bytes: 22 * 71 });

  const steady = adaptTreeWorkingSetsToRetainedPacketsReference(geometry, materials, first);
  assert.strictEqual(steady.packets[0], first.packets[0]);
  assert.deepEqual(steady.delta.upsert, []);
  assert.deepEqual(steady.delta.remove, []);
  assert.deepEqual(steady.delta.unchanged, [first.packets[0].id]);
  assert.deepEqual(steady.delta.upload, { packets: 0, primitives: 0, bytes: 0 });
});

test('tree renderer adapter retains unchanged trees across refinement and localizes parents', () => {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const planner = createTreeGeometryPlannerReference(IDENTITY);
  const field = createTreeMaterialFieldReference(IDENTITY);
  const coarseGeometry = planTreeGeometryReference(planner, forest, {
    treeIndices: [0, 1],
    detailLevels: [0, 0],
    primitiveBudget: 64,
  });
  const coarseMaterials = realizeTreeMaterialsReference(field, forest, coarseGeometry, {
    materialBudget: 64,
  });
  const coarse = adaptTreeWorkingSetsToRetainedPacketsReference(
    coarseGeometry,
    coarseMaterials,
  );
  const refinedGeometry = planTreeGeometryReference(planner, forest, {
    treeIndices: [0, 1],
    detailLevels: [2, 0],
    primitiveBudget: 64,
  });
  const refinedMaterials = realizeTreeMaterialsReference(field, forest, refinedGeometry, {
    materialBudget: 64,
  });
  const refined = adaptTreeWorkingSetsToRetainedPacketsReference(
    refinedGeometry,
    refinedMaterials,
    coarse,
  );

  assert.equal(refined.packets.length, 2);
  assert.notStrictEqual(refined.packets[0], coarse.packets[0]);
  assert.strictEqual(refined.packets[1], coarse.packets[1]);
  assert.deepEqual(refined.delta.unchanged, [coarse.packets[1].id]);
  assert.deepEqual(refined.delta.upload, { packets: 1, primitives: 22, bytes: 22 * 71 });
  assert.deepEqual(Array.from(refined.packets[0].parents.slice(0, 6)), [-1, -1, 0, 0, 0, 0]);
  assert.ok(Array.from(refined.packets[0].parents.slice(6)).every((parent) => (
    parent >= 2 && parent <= 5
  )));

  const remainingGeometry = planTreeGeometryReference(planner, forest, {
    treeIndices: [1],
    detailLevels: [0],
    primitiveBudget: 64,
  });
  const remainingMaterials = realizeTreeMaterialsReference(field, forest, remainingGeometry, {
    materialBudget: 64,
  });
  const remaining = adaptTreeWorkingSetsToRetainedPacketsReference(
    remainingGeometry,
    remainingMaterials,
    refined,
  );
  assert.strictEqual(remaining.packets[0], coarse.packets[1]);
  assert.deepEqual(remaining.delta.remove, [refined.packets[0].id]);
  assert.deepEqual(remaining.delta.upload, { packets: 0, primitives: 0, bytes: 0 });
});
