import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionChild,
  conditionedNodeStreamReference,
  createConditionedRoot,
} from '../../web/vf-ui/vf-conditioned-distribution.mjs';
import {
  sampleGrassMaterialLodReference,
} from '../../web/vf-ui/vf-grass-material-gpu.mjs';

const STREAM = conditionedNodeStreamReference(conditionChild(
  createConditionedRoot({
    generator: 'vkf.conditioned',
    version: 1,
    seed: [0x01234567, 0x89abcdef],
    domain: 'material',
    hierarchy: ['world:temperate', 'grass-field:gpu-material'],
    lod: 0,
    channel: 'surface',
  }),
  { segment: 'grass:cell:2:-1', channel: 'blade-traits' },
));

const BASE = Object.freeze({
  baseColor: Object.freeze([0.18, 0.44, 0.09, 1]),
  roughness: 0.84,
  stream: STREAM,
  bladeIndex: 7,
});

function sample(detailLevel, footprint) {
  return sampleGrassMaterialLodReference({
    ...BASE,
    detailLevel,
    footprint,
  });
}

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
}

test('grass micro-material detail fades continuously from an exact coarse identity', () => {
  const legacy = sample(3, 0);
  const unresolved = sample(4, 1 / 64);
  const transition = sample(4, 3 / 256);
  const fine = sample(4, 1 / 128);

  assert.deepEqual(legacy, {
    baseColor: BASE.baseColor,
    roughness: BASE.roughness,
  });
  assert.deepEqual(unresolved, legacy);
  assert.notDeepEqual(fine, legacy);
  for (let lane = 0; lane < 4; lane += 1) {
    close(
      transition.baseColor[lane],
      (legacy.baseColor[lane] + fine.baseColor[lane]) / 2,
    );
  }
  close(
    transition.roughness,
    (legacy.roughness + fine.roughness) / 2,
  );
  assert.deepEqual(sample(4, 3 / 256), transition);
});
