import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionChild,
  createConditionedRoot,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import {
  queryMarkedPointRegion2Reference,
  sampleMarkedPointCell2Reference,
} from '../../web/vf-ui/vf-marked-point-candidates.mjs';

const ROOT_IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['environment:alpine', 'species:grass'],
  lod: 4,
  channel: 'traits',
});

function createPointNode() {
  return conditionChild(createConditionedRoot(ROOT_IDENTITY), {
    segment: 'forest:7',
    channel: 'trees',
  });
}

test('queried cell produces pinned bounded candidate identities and marks', () => {
  const candidates = sampleMarkedPointCell2Reference(createPointNode(), [2, -1], {
    cellSize: 10,
    maxCandidates: 2,
    baseProbability: 1,
    correlationLength: 20,
    spatialStrength: 0,
  });

  assert.deepEqual(candidates, [
    {
      id: 'candidate:v1:b0709f36:2f5feefc',
      cell: [2, -1],
      slot: 0,
      position: [24.33209284907207, -2.935679443180561],
      marks: { weight: 0.30771112302318215, angle: 4.4799549441969715 },
    },
    {
      id: 'candidate:v1:fb1ae87e:1581e99c',
      cell: [2, -1],
      slot: 1,
      position: [20.41999283246696, -9.32815571082756],
      marks: { weight: 0.3901456024032086, angle: 3.1238375664991485 },
    },
  ]);
  assert.ok(Object.isFrozen(candidates));
  assert.ok(candidates.every((candidate) => Object.isFrozen(candidate)));
  assert.ok(candidates.every((candidate) => Object.isFrozen(candidate.position)));
  assert.ok(candidates.every((candidate) => Object.isFrozen(candidate.marks)));
});

test('cell candidate generation rejects malformed or unbounded requests', () => {
  const node = createPointNode();
  const valid = {
    cellSize: 10,
    maxCandidates: 2,
    baseProbability: 0.5,
    correlationLength: 20,
    spatialStrength: 0.5,
  };
  const sample = (cell, overrides = {}) => sampleMarkedPointCell2Reference(
    node,
    cell,
    { ...valid, ...overrides },
  );

  assert.throws(() => sample([0]), TypeError);
  assert.throws(() => sample([0.5, 0]), TypeError);
  assert.throws(() => sample([0x80000000, 0]), RangeError);
  assert.throws(() => sample([0, 0], { cellSize: 0 }), RangeError);
  assert.throws(() => sample([0, 0], { maxCandidates: -1 }), RangeError);
  assert.throws(() => sample([0, 0], { maxCandidates: 1_025 }), RangeError);
  assert.throws(() => sample([0, 0], { baseProbability: 1.1 }), RangeError);
  assert.throws(() => sample([0, 0], { correlationLength: Infinity }), RangeError);
  assert.throws(() => sample([0, 0], { spatialStrength: -0.1 }), RangeError);
  assert.throws(() => sample([0, 0], { spatialStrength: 1.1 }), RangeError);
  assert.deepEqual(sample(new Int32Array([0, 0]), { maxCandidates: 0 }), []);
});

test('region query includes candidates from every crossed neighbor cell', () => {
  const candidates = queryMarkedPointRegion2Reference(
    createPointNode(),
    { min: [8, -3], max: [11.6, 2.5] },
    {
      cellSize: 10,
      maxCandidates: 8,
      baseProbability: 1,
      correlationLength: 20,
      spatialStrength: 0,
    },
  );

  assert.deepEqual(
    candidates.map(({ id, cell, slot }) => ({ id, cell, slot })),
    [
      { id: 'candidate:v1:5f176be7:5643cbb0', cell: [0, -1], slot: 2 },
      { id: 'candidate:v1:df812db2:ecc08f23', cell: [1, -1], slot: 4 },
      { id: 'candidate:v1:76f3e6d1:18391f06', cell: [0, 0], slot: 5 },
      { id: 'candidate:v1:1357d14d:34ffea71', cell: [1, 0], slot: 1 },
      { id: 'candidate:v1:dc612832:2e626ea1', cell: [1, 0], slot: 5 },
    ],
  );
  assert.ok(Object.isFrozen(candidates));
});

test('region query rejects malformed bounds and unbounded work', () => {
  const node = createPointNode();
  const options = {
    cellSize: 10,
    maxCandidates: 2,
    baseProbability: 0.5,
    correlationLength: 20,
    spatialStrength: 0.5,
  };
  const query = (bounds, overrides = {}) => queryMarkedPointRegion2Reference(
    node,
    bounds,
    { ...options, ...overrides },
  );

  assert.throws(() => query({ min: [0], max: [1, 1] }), TypeError);
  assert.throws(() => query({ min: [0, NaN], max: [1, 1] }), RangeError);
  assert.throws(() => query({ min: [1, 0], max: [1, 1] }), RangeError);
  assert.throws(() => query({ min: [0, 0], max: [40_970, 10] }), RangeError);
  assert.throws(
    () => query({ min: [0, 0], max: [650, 10] }, { maxCandidates: 1_024 }),
    RangeError,
  );
  assert.throws(
    () => query({ min: [21_474_836_480, 0], max: [21_474_836_490, 10] }),
    RangeError,
  );
});

test('adjacent half-open regions neither lose nor duplicate boundary candidates', () => {
  const node = createPointNode();
  const options = {
    cellSize: 10,
    maxCandidates: 8,
    baseProbability: 1,
    correlationLength: 20,
    spatialStrength: 0,
  };
  const query = (min, max) => queryMarkedPointRegion2Reference(
    node,
    { min, max },
    options,
  );
  const left = query([0, 0], [10, 10]);
  const right = query([10, 0], [20, 10]);
  const whole = query([0, 0], [20, 10]);
  const adjacentIds = [...left, ...right].map(({ id }) => id);

  assert.equal(new Set(adjacentIds).size, adjacentIds.length);
  assert.deepEqual(adjacentIds, whole.map(({ id }) => id));
});
