import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionChild,
  createConditionedRoot,
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
