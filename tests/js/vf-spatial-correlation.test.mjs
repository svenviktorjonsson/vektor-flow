import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionChild,
  createConditionedRoot,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from '../../web/vf-ui/vf-spatial-correlation.mjs';

const ROOT_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['environment:alpine', 'species:grass'],
  lod: 4,
  channel: 'traits',
});

function createFieldNode() {
  return conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'patch:7',
    channel: 'moisture-field',
  });
}

test('spatial correlation samples a pinned continuous field value', () => {
  assert.equal(
    sampleSpatialCorrelation2Reference(createFieldNode(), [3.25, -1.5], {
      correlationLength: 2,
      mean: 10,
      amplitude: 3,
    }),
    9.032170148338288,
  );
});

test('spatial correlation rejects unbounded or malformed queries', () => {
  const node = createFieldNode();
  const valid = { correlationLength: 2, mean: 10, amplitude: 3 };
  const sample = (position, overrides = {}) => sampleSpatialCorrelation2Reference(
    node,
    position,
    { ...valid, ...overrides },
  );

  assert.throws(() => sample([0]), TypeError);
  assert.throws(() => sample([0, NaN]), RangeError);
  assert.throws(() => sample([0, 0], { correlationLength: 0 }), RangeError);
  assert.throws(() => sample([0, 0], { correlationLength: Infinity }), RangeError);
  assert.throws(() => sample([0, 0], { mean: NaN }), RangeError);
  assert.throws(() => sample([0, 0], { amplitude: -1 }), RangeError);
  assert.throws(() => sample([0, 0], { amplitude: Infinity }), RangeError);
  assert.throws(() => sample([2_147_483_647, 0], { correlationLength: 1 }), RangeError);
  assert.throws(() => sample([-2_147_483_649, 0], { correlationLength: 1 }), RangeError);
  assert.equal(
    sample(new Float64Array([3.25, -1.5]), { amplitude: 0 }),
    10,
  );
});

test('spatial field identity is hierarchical and scale-stable', () => {
  const target = createFieldNode();
  const recreated = createFieldNode();
  const sibling = conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'patch:8',
    channel: 'moisture-field',
  });
  const options = { correlationLength: 2, mean: 10, amplitude: 3 };
  const value = sampleSpatialCorrelation2Reference(target, [3.25, -1.5], options);

  assert.equal(
    value,
    sampleSpatialCorrelation2Reference(recreated, [3.25, -1.5], options),
  );
  assert.equal(
    value,
    sampleSpatialCorrelation2Reference(target, [6.5, -3], {
      ...options,
      correlationLength: 4,
    }),
  );
  assert.notEqual(
    value,
    sampleSpatialCorrelation2Reference(sibling, [3.25, -1.5], options),
  );
  assert.ok(Object.isFrozen(target));
  assert.ok(Object.isFrozen(target.hierarchy));
});
