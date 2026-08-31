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

test('nearby field queries share correlation while distant queries do not', () => {
  const node = createFieldNode();
  const options = { correlationLength: 1, mean: 0, amplitude: 1 };
  const count = 8_192;
  const measureCorrelation = (offsetX, offsetY) => {
    let sumA = 0;
    let sumB = 0;
    let sumAA = 0;
    let sumBB = 0;
    let sumAB = 0;
    for (let index = 0; index < count; index += 1) {
      const x = (index * 0.7548776662466927) % 256;
      const y = (index * 0.5698402909980532) % 256;
      const a = sampleSpatialCorrelation2Reference(node, [x, y], options);
      const b = sampleSpatialCorrelation2Reference(
        node,
        [x + offsetX, y + offsetY],
        options,
      );
      sumA += a;
      sumB += b;
      sumAA += a * a;
      sumBB += b * b;
      sumAB += a * b;
    }
    const meanA = sumA / count;
    const meanB = sumB / count;
    const varianceA = sumAA / count - meanA * meanA;
    const varianceB = sumBB / count - meanB * meanB;
    const covariance = sumAB / count - meanA * meanB;
    return covariance / Math.sqrt(varianceA * varianceB);
  };

  const nearby = measureCorrelation(0.05, 0.02);
  const distant = measureCorrelation(37.5, 19.25);
  assert.ok(Math.abs(nearby - 0.9947067344658742) < 1e-12);
  assert.ok(Math.abs(distant - (-0.001725963388763766)) < 1e-12);
  assert.ok(nearby > 0.99);
  assert.ok(Math.abs(distant) < 0.02);
});

test('spatial field queries are traversal and chunk independent', () => {
  const node = createFieldNode();
  const options = { correlationLength: 3, mean: 2, amplitude: 0.5 };
  const positions = Array.from({ length: 64 }, (_, index) => [
    index * 0.375 - 12,
    (index * index % 23) * 0.25 - 2,
  ]);
  const sample = (position) => sampleSpatialCorrelation2Reference(
    node,
    position,
    options,
  );
  const expected = positions.map(sample);

  const reverse = new Map(
    [...positions].reverse().map((position) => [position.join(':'), sample(position)]),
  );
  assert.deepEqual(
    positions.map((position) => reverse.get(position.join(':'))),
    expected,
  );

  const chunks = [positions.slice(0, 3), positions.slice(3, 41), positions.slice(41)];
  assert.deepEqual(chunks.flatMap((chunk) => chunk.map(sample)), expected);
});
