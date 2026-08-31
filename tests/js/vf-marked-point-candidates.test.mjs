import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionChild,
  createConditionedRoot,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import {
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
