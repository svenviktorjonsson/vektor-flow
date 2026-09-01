import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function workingSet() {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const planner = createTreeGeometryPlannerReference(IDENTITY);
  const coarse = planTreeGeometryReference(planner, forest, {
    treeIndices: [0],
    detailLevels: [0],
    primitiveBudget: 64,
  });
  const refined = planTreeGeometryReference(planner, forest, {
    treeIndices: [0],
    detailLevels: [2],
    primitiveBudget: 64,
  });
  return { forest, coarse, refined };
}

test('tree materials lazily pack bark and foliage over demanded geometry only', () => {
  const { forest, refined } = workingSet();
  const field = createTreeMaterialFieldReference(IDENTITY);
  const materials = realizeTreeMaterialsReference(field, forest, refined, {
    materialBudget: 64,
  });

  assert.equal(materials.kind, 'tree-material-working-set:v1');
  assert.equal(materials.materialCount, 22);
  assert.deepEqual(Array.from(materials.materialKinds), [
    0, 1, 0, 0, 0, 0,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  ]);
  assert.ok(materials.materialKinds instanceof Uint8Array);
  assert.ok(materials.baseColors instanceof Float32Array);
  assert.ok(materials.surfaceParams instanceof Float32Array);
  assert.equal(materials.baseColors.length, materials.materialCount * 4);
  assert.equal(materials.surfaceParams.length, materials.materialCount * 4);
  assert.equal(materials.vectorBytes, 22 * 33);
  assert.deepEqual(materials.primitiveIds, refined.primitiveIds);
  assert.deepEqual(Array.from(materials.baseColors.slice(0, 8)), [
    0.2267715483903885,
    0.1599140167236328,
    0.08004822582006454,
    1,
    0.18103784322738647,
    0.28691360354423523,
    0.08560787886381149,
    1,
  ]);
  assert.deepEqual(Array.from(materials.surfaceParams.slice(0, 8)), [
    0.7590516805648804,
    0.5253937244415283,
    0,
    5.355871677398682,
    0.5821430087089539,
    0.36743852496147156,
    0.13025176525115967,
    2.1605498790740967,
  ]);
});

test('coarse-to-fine material refinement preserves shared primitive identities', () => {
  const { forest, coarse, refined } = workingSet();
  const field = createTreeMaterialFieldReference(IDENTITY);
  const coarseMaterials = realizeTreeMaterialsReference(field, forest, coarse, {
    materialBudget: 64,
  });
  const refinedMaterials = realizeTreeMaterialsReference(field, forest, refined, {
    materialBudget: 64,
  });
  const recreated = realizeTreeMaterialsReference(
    createTreeMaterialFieldReference(IDENTITY),
    forest,
    refined,
    { materialBudget: 64 },
  );

  assert.strictEqual(refinedMaterials.materials[0], coarseMaterials.materials[0]);
  assert.strictEqual(refinedMaterials.materials[1], coarseMaterials.materials[1]);
  assert.deepEqual(
    Array.from(refinedMaterials.baseColors.slice(0, coarseMaterials.baseColors.length)),
    Array.from(coarseMaterials.baseColors),
  );
  assert.deepEqual(recreated, refinedMaterials);
});

test('species traits condition distinct individual bark and foliage surfaces', () => {
  const { forest } = workingSet();
  assert.equal(forest.speciesIndices[0], forest.speciesIndices[1]);
  const plan = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0, 1], detailLevels: [0, 0], primitiveBudget: 8 },
  );
  const materials = realizeTreeMaterialsReference(
    createTreeMaterialFieldReference(IDENTITY),
    forest,
    plan,
    { materialBudget: 8 },
  );

  assert.deepEqual(Array.from(materials.materialKinds), [0, 1, 0, 1]);
  assert.notDeepEqual(
    Array.from(materials.baseColors.slice(0, 4)),
    Array.from(materials.baseColors.slice(8, 12)),
  );
  assert.notDeepEqual(
    Array.from(materials.baseColors.slice(4, 8)),
    Array.from(materials.baseColors.slice(12, 16)),
  );
});

test('material realization remains hard bounded and retains a finite tree cache', async () => {
  const { forest, refined } = workingSet();
  const field = createTreeMaterialFieldReference(IDENTITY);
  const bounded = realizeTreeMaterialsReference(field, forest, refined, {
    materialBudget: 5,
  });
  const empty = realizeTreeMaterialsReference(field, forest, refined, {
    materialBudget: 0,
  });
  const source = await readFile(
    new URL('../../web/vf-ui/vf-tree-material-field.mjs', import.meta.url),
    'utf8',
  );

  assert.equal(bounded.materialCount, 5);
  assert.equal(bounded.vectorBytes, 165);
  assert.equal(empty.materialCount, 0);
  assert.equal(empty.vectorBytes, 0);
  assert.match(source, /const MAX_CACHED_MATERIAL_TREES = 4096;/);
  assert.match(source, /treeCache\.size > MAX_CACHED_MATERIAL_TREES/);
  assert.throws(() => realizeTreeMaterialsReference(field, forest, refined, {
    materialBudget: 65537,
  }), /materialBudget/);
});
