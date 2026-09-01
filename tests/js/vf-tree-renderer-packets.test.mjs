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
