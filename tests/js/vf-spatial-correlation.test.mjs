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
