import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStoneFamilyPopulationReference,
  realizeStoneFamilyPatchesReference,
} from '../../web/vf-ui/vf-stone-family-population.mjs';
import {
  sampleRockMaterialReference,
} from '../../web/vf-ui/vf-rock-material-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x510e527f, 0x9b05688c]),
  domain: 'material',
  hierarchy: Object.freeze(['world:highland', 'stone-field:north']),
  lod: 0,
  channel: 'population',
});

test('one demanded patch lazily realizes a vector-first conditioned stone family', () => {
  const population = createStoneFamilyPopulationReference(IDENTITY);
  const first = realizeStoneFamilyPatchesReference(population, {
    patches: [[2, -1]],
    stoneBudget: 16,
  });
  const repeated = realizeStoneFamilyPatchesReference(population, {
    patches: [new Int32Array([2, -1])],
    stoneBudget: 16,
  });

  assert.equal(first.kind, 'stone-family-patch-working-set:v1');
  assert.equal(first.demandedPatchCount, 1);
  assert.ok(first.stoneCount > 0 && first.stoneCount <= 16);
  assert.equal(first.positions.length, first.stoneCount * 3);
  assert.equal(first.radii.length, first.stoneCount * 3);
  assert.equal(first.rotations.length, first.stoneCount);
  assert.equal(first.familyIndices.length, first.stoneCount);
  assert.ok(first.positions instanceof Float32Array);
  assert.ok(first.radii instanceof Float32Array);
  assert.ok(first.rotations instanceof Float32Array);
  assert.ok(first.familyIndices instanceof Uint32Array);
  assert.strictEqual(repeated.patches[0], first.patches[0]);
  assert.deepEqual(repeated, first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.patches));

  const family = first.families.find(({ index }) => index === first.familyIndices[0]);
  const material = sampleRockMaterialReference(family.materialField, [0.25, -0.5], {
    detailLevel: 3,
    footprint: 0.025,
  });
  assert.ok(material.roughness >= 0.58 && material.roughness <= 0.92);
});
