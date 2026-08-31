import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionChild,
  createConditionedRoot,
  normalReferenceFromU32,
  sampleBoundedUniform,
  sampleNormalReference,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';

const ROOT_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['environment:alpine', 'species:grass'],
  lod: 4,
  channel: 'traits',
});

test('normal reference transform matches a pinned Box-Muller oracle', () => {
  const root = createConditionedRoot(ROOT_IDENTITY);
  const child = conditionChild(root, {
    segment: 'instance:17',
    channel: 'blade-height',
  });

  assert.equal(
    sampleNormalReference(child, [3, 0], { mean: 10, standardDeviation: 2.5 }),
    8.875981430658127,
  );
  assert.equal(
    normalReferenceFromU32(
      [0x8a27a5d3, 0x50fb04ea],
      { mean: 10, standardDeviation: 2.5 },
    ),
    8.875981430658127,
  );
});

test('stable parent identity conditions children without branch state', () => {
  const makeChild = (identity, segment) => conditionChild(
    createConditionedRoot(identity),
    { segment, channel: 'blade-height' },
  );
  const target = makeChild(ROOT_IDENTITY, 'instance:17');
  const recreated = makeChild(structuredClone(ROOT_IDENTITY), 'instance:17');
  const sibling = makeChild(ROOT_IDENTITY, 'instance:18');
  const changedParent = makeChild({
    ...ROOT_IDENTITY,
    seed: [ROOT_IDENTITY.seed[0] + 1, ROOT_IDENTITY.seed[1]],
  }, 'instance:17');
  const sample = [3, 0];
  const bounds = { min: -2, max: 5 };

  const before = sampleBoundedUniform(target, sample, bounds);
  sampleBoundedUniform(sibling, [0xffffffff, 0xffffffff], bounds);
  sampleNormalReference(sibling, [99, 0], { mean: 0, standardDeviation: 1 });
  const after = sampleBoundedUniform(target, sample, bounds);

  assert.equal(before, after);
  assert.equal(before, sampleBoundedUniform(recreated, sample, bounds));
  assert.notEqual(before, sampleBoundedUniform(sibling, sample, bounds));
  assert.notEqual(before, sampleBoundedUniform(changedParent, sample, bounds));
});

test('conditioned samples are traversal and chunk independent', () => {
  const child = conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'instance:17',
    channel: 'blade-height',
  });
  const samples = Array.from({ length: 32 }, (_, index) => [index, 0]);
  const samplePair = (sample) => [
    sampleBoundedUniform(child, sample, { min: -2, max: 5 }),
    sampleNormalReference(child, sample, { mean: 10, standardDeviation: 2.5 }),
  ];
  const expected = samples.map(samplePair);
  const reverse = new Map(
    [...samples].reverse().map((sample) => [sample[0], samplePair(sample)]),
  );
  assert.deepEqual(samples.map((sample) => reverse.get(sample[0])), expected);

  const chunks = [samples.slice(0, 3), samples.slice(3, 19), samples.slice(19)];
  assert.deepEqual(chunks.flatMap((chunk) => chunk.map(samplePair)), expected);
});

test('immutable child identity produces a pinned bounded-uniform sample', () => {
  const root = createConditionedRoot(ROOT_IDENTITY);
  const child = conditionChild(root, {
    segment: 'instance:17',
    channel: 'blade-height',
  });

  assert.ok(Object.isFrozen(root));
  assert.ok(Object.isFrozen(child));
  assert.ok(Object.isFrozen(child.hierarchy));
  assert.deepEqual(child.hierarchy, [
    'environment:alpine',
    'species:grass',
    'instance:17',
  ]);
  assert.equal(
    sampleBoundedUniform(child, [3, 0], { min: -2, max: 5 }),
    1.7776723366696388,
  );
  assert.throws(() => child.hierarchy.push('mutation'), TypeError);
});
