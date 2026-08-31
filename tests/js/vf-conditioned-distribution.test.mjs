import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionChild,
  correlatedNormal2ReferenceFromU32,
  createConditionedRoot,
  normalReferenceFromU32,
  sampleBoundedUniform,
  sampleCorrelatedNormal2Reference,
  sampleNormalReference,
  sampleWeightedCategoricalIndex,
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

test('weighted categorical sampling selects a pinned category without expansion', () => {
  const child = conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'instance:17',
    channel: 'species',
  });

  assert.equal(
    sampleWeightedCategoricalIndex(child, [3, 0], [1, 3, 6]),
    2,
  );
});

test('weighted categorical sampling strictly validates compact weights', () => {
  const child = conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'instance:17',
    channel: 'species',
  });
  const sample = [3, 0];

  assert.throws(() => sampleWeightedCategoricalIndex(child, sample, []), RangeError);
  assert.throws(() => sampleWeightedCategoricalIndex(child, sample, [0, 0]), RangeError);
  assert.throws(() => sampleWeightedCategoricalIndex(child, sample, [1, -1]), RangeError);
  assert.throws(() => sampleWeightedCategoricalIndex(child, sample, [1, NaN]), RangeError);
  assert.throws(
    () => sampleWeightedCategoricalIndex(child, sample, [Number.MAX_VALUE, Number.MAX_VALUE]),
    RangeError,
  );
  assert.throws(
    () => sampleWeightedCategoricalIndex(child, sample, new Set([1, 2])),
    TypeError,
  );

  const compactHugeWeights = Object.freeze([1e15, 3e15]);
  assert.equal(
    sampleWeightedCategoricalIndex(child, sample, compactHugeWeights),
    1,
  );
});

test('normal reference transform matches a pinned Box-Muller oracle', () => {
  const root = createConditionedRoot(ROOT_IDENTITY);
  const child = conditionChild(root, {
    segment: 'instance:17',
    channel: 'blade-height',
  });

  assert.equal(
    sampleNormalReference(child, [3, 0], { mean: 10, standardDeviation: 2.5 }),
    9.471712514179357,
  );
  assert.equal(
    normalReferenceFromU32(
      [0x8a27a5d3, 0x50fb04ea],
      { mean: 10, standardDeviation: 2.5 },
    ),
    8.875981430658127,
  );
});

test('correlated-normal transform matches a pinned two-dimensional oracle', () => {
  assert.deepEqual(
    correlatedNormal2ReferenceFromU32(
      [0xf4d2fe28, 0x9ffe0525],
      {
        mean: [10, -5],
        standardDeviation: [2.5, 4],
        correlation: 0.75,
      },
    ),
    [9.471712514179357, -6.192819693750724],
  );
});

test('demand-keyed correlated normal reaches the same pinned oracle', () => {
  const child = conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'instance:17',
    channel: 'blade-height',
  });

  assert.deepEqual(
    sampleCorrelatedNormal2Reference(child, [3, 0], {
      mean: [10, -5],
      standardDeviation: [2.5, 4],
      correlation: 0.75,
    }),
    [9.471712514179357, -6.192819693750724],
  );
});

test('correlated-normal transform rejects malformed or impossible parameters', () => {
  const words = [0xf4d2fe28, 0x9ffe0525];
  const valid = {
    mean: [10, -5],
    standardDeviation: [2.5, 4],
    correlation: 0.75,
  };
  const transform = (overrides) => correlatedNormal2ReferenceFromU32(
    words,
    { ...valid, ...overrides },
  );

  assert.throws(() => transform({ mean: [0] }), TypeError);
  assert.throws(() => transform({ mean: [0, NaN] }), RangeError);
  assert.throws(() => transform({ standardDeviation: [1] }), TypeError);
  assert.throws(() => transform({ standardDeviation: [1, -1] }), RangeError);
  assert.throws(() => transform({ standardDeviation: [1, Infinity] }), RangeError);
  assert.throws(() => transform({ correlation: NaN }), RangeError);
  assert.throws(() => transform({ correlation: 1.0000001 }), RangeError);
  assert.throws(() => transform({ correlation: -1.0000001 }), RangeError);
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
  const changedParentChannel = makeChild({
    ...ROOT_IDENTITY,
    channel: 'other-traits',
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
  assert.notEqual(before, sampleBoundedUniform(changedParentChannel, sample, bounds));
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
    4.694411462172866,
  );
  assert.throws(() => child.hierarchy.push('mutation'), TypeError);
});
