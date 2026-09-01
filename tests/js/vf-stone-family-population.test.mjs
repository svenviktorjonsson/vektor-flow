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

test('patch affinity and individual variation match a pinned stone population', () => {
  const working = realizeStoneFamilyPatchesReference(
    createStoneFamilyPopulationReference(IDENTITY),
    { patches: [[2, -1]], stoneBudget: 16 },
  );

  assert.equal(working.stoneCount, 13);
  assert.equal(working.vectorBytes, 416);
  assert.deepEqual(Array.from(working.familyIndices), [
    3, 3, 3, 1, 3, 2, 3, 3, 2, 3, 3, 3, 3,
  ]);
  assert.deepEqual(Array.from(working.positions.slice(0, 6)), [
    11.204845428466797,
    -3.855315685272217,
    0.4602487087249756,
    8.276394844055176,
    -3.616556406021118,
    0.3930971324443817,
  ]);
  assert.deepEqual(working.families.map(({ id }) => id), [
    'stone:family:1',
    'stone:family:2',
    'stone:family:3',
  ]);
  assert.equal(working.patches[0].dominantFamily, 3);
  assert.equal(
    Array.from(working.familyIndices).filter((family) => family === 3).length,
    10,
  );
});

test('stone patch demand is order independent and enforces bounded lazy work', () => {
  const population = createStoneFamilyPopulationReference(IDENTITY);
  const forward = realizeStoneFamilyPatchesReference(population, {
    patches: [[2, -1], [3, 0], [2, -1]],
    stoneBudget: 21,
  });
  const reversed = realizeStoneFamilyPatchesReference(population, {
    patches: [[3, 0], [2, -1]],
    stoneBudget: 21,
  });
  const recreated = realizeStoneFamilyPatchesReference(
    createStoneFamilyPopulationReference(IDENTITY),
    { patches: [[3, 0], [2, -1]], stoneBudget: 21 },
  );
  const emptyDistant = realizeStoneFamilyPatchesReference(population, {
    patches: [[1_000_000_000, -1_000_000_000]],
    stoneBudget: 0,
  });
  const boundedDistant = realizeStoneFamilyPatchesReference(population, {
    patches: [[1_000_000_000, -1_000_000_000]],
    stoneBudget: 5,
  });

  assert.deepEqual(reversed, forward);
  assert.deepEqual(recreated, forward);
  assert.strictEqual(reversed.patches[0], forward.patches[0]);
  assert.equal(emptyDistant.stoneCount, 0);
  assert.equal(emptyDistant.patches.length, 0);
  assert.equal(emptyDistant.vectorBytes, 0);
  assert.equal(boundedDistant.stoneCount, 5);
  assert.equal(boundedDistant.vectorBytes, 160);
  assert.equal(boundedDistant.patches.length, 1);
  assert.throws(
    () => realizeStoneFamilyPatchesReference(population, {
      patches: Array.from({ length: 4097 }, () => [0, 0]),
      stoneBudget: 0,
    }),
    /exceeds 4096 patches/,
  );
  assert.throws(
    () => realizeStoneFamilyPatchesReference(population, {
      patches: [[0, 0]],
      stoneBudget: 65537,
    }),
    /stone budget exceeds 65536/,
  );
});
