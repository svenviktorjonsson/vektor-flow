import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRockMaterialFieldReference,
  sampleRockMaterialReference,
} from '../../web/vf-ui/vf-rock-material-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:highland', 'stone:31']),
  lod: 0,
  channel: 'surface',
});

test('an unchanged stone surface demand reuses its realized immutable material sample', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const options = Object.freeze({ detailLevel: 4, footprint: 0.0125 });

  const first = sampleRockMaterialReference(field, [0.3125, -0.4375], options);
  const repeated = sampleRockMaterialReference(field, [0.3125, -0.4375], options);
  const recreated = sampleRockMaterialReference(
    createRockMaterialFieldReference(IDENTITY),
    [0.3125, -0.4375],
    options,
  );

  assert.strictEqual(repeated, first);
  assert.notStrictEqual(recreated, first);
  assert.deepEqual(recreated, first);
  assert.ok(Object.isFrozen(first));
});
