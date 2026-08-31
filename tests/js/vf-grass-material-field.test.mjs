import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGrassMaterialFieldReference,
  sampleGrassMaterialReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:3'],
  lod: 0,
  channel: 'surface',
});

test('grass material samples deterministic field and patch variation on demand', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const options = { detailLevel: 4, footprint: 0.02 };
  const first = sampleGrassMaterialReference(field, [3.25, -1.5], options);
  const recreated = sampleGrassMaterialReference(
    createGrassMaterialFieldReference(IDENTITY),
    [3.25, -1.5],
    options,
  );

  assert.deepEqual(first, recreated);
  assert.equal(field.kind, 'grass-multiscale-field:v1');
  assert.equal(field.maxOctaves, 6);
  assert.ok(first.fieldVariation >= -1 && first.fieldVariation <= 1);
  assert.ok(first.patchVariation >= -1 && first.patchVariation <= 1);
  assert.ok(first.coverage >= 0 && first.coverage <= 1);
  assert.ok(first.bladeHeight >= 0.18 && first.bladeHeight <= 0.72);
  assert.ok(first.roughness >= 0.72 && first.roughness <= 0.98);
  assert.equal(first.baseColor.length, 4);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.baseColor));
});
