import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRockMaterialFieldReference,
  sampleRockMaterialReference,
} from '../../web/vf-ui/vf-rock-material-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x01234567, 0x89abcdef]),
  domain: 'material',
  hierarchy: Object.freeze(['world:alpine', 'rock:17']),
  lod: 0,
  channel: 'surface',
});

test('one shared geology field drives correlated rock material channels', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const sample = sampleRockMaterialReference(field, [0.125, -0.375], {
    detailLevel: 2,
    footprint: 0.04,
  });
  const weathering = Math.max(0, Math.min(1, 0.5 + 0.5 * sample.geology));

  assert.equal(sample.weathering, weathering);
  assert.deepEqual(sample.baseColor, [
    0.22 + (0.55 - 0.22) * weathering,
    0.19 + (0.49 - 0.19) * weathering,
    0.15 + (0.4 - 0.15) * weathering,
    1,
  ]);
  assert.equal(sample.roughness, 0.92 - 0.34 * weathering);
  assert.equal(sample.displacement, 0.08 * sample.geology);
  assert.ok(Math.abs(Math.hypot(...sample.tangentNormal) - 1) < 1e-15);
  assert.ok(Object.isFrozen(field));
  assert.ok(Object.isFrozen(sample));
  assert.ok(Object.isFrozen(sample.baseColor));
  assert.ok(Object.isFrozen(sample.tangentNormal));
});

test('rock material derivative matches a pinned central-difference oracle', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const options = { detailLevel: 2, footprint: 0.04 };
  const position = [0.125, -0.375];
  const sample = sampleRockMaterialReference(field, position, options);
  const step = 1e-4;
  const geologyAt = (u, v) => sampleRockMaterialReference(
    field,
    [u, v],
    options,
  ).geology;
  const oracle = [
    (geologyAt(position[0] + step, position[1])
      - geologyAt(position[0] - step, position[1])) / (2 * step),
    (geologyAt(position[0], position[1] + step)
      - geologyAt(position[0], position[1] - step)) / (2 * step),
  ];

  assert.equal(sample.geology, 0.1157007647847343);
  assert.deepEqual(sample.derivative, [
    -2.352305242111219,
    -2.107711252649358,
  ]);
  assert.deepEqual(sample.derivative, oracle);
  assert.deepEqual(sample.tangentNormal, [
    0.36808735109403024,
    0.3298134264082471,
    0.8693300901990175,
  ]);
});

test('footprint filtering keeps shared surface samples stable across detail levels', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const position = [0.125, -0.375];
  const coarse = sampleRockMaterialReference(field, position, {
    detailLevel: 0,
    footprint: 0.5,
  });
  const refined = sampleRockMaterialReference(field, position, {
    detailLevel: 5,
    footprint: 0.5,
  });
  const visibleFine = sampleRockMaterialReference(field, position, {
    detailLevel: 5,
    footprint: 0.01,
  });
  const extremeDetail = sampleRockMaterialReference(field, position, {
    detailLevel: Number.MAX_SAFE_INTEGER,
    footprint: 0.01,
  });

  assert.deepEqual(refined, coarse);
  assert.equal(coarse.geology, -0.2912937415105119);
  assert.equal(visibleFine.geology, 0.12466605886703269);
  assert.notEqual(visibleFine.geology, coarse.geology);
  assert.deepEqual(extremeDetail, visibleFine);
  assert.equal(field.maxOctaves, 6);
});
