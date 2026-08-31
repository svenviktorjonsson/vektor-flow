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
