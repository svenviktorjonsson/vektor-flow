import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('stone material realization has a fixed least-recently-used working-set cap', async () => {
  const source = await readFile(
    new URL('../../web/vf-ui/vf-rock-material-field.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /const MAX_REALIZED_MATERIAL_SAMPLES = 2048;/);
  assert.match(source, /materialSamples\.delete\(cacheKey\);\s*materialSamples\.set\(cacheKey, cached\);/s);
  assert.match(source, /materialSamples\.size > MAX_REALIZED_MATERIAL_SAMPLES/);
  assert.match(source, /materialSamples\.delete\(materialSamples\.keys\(\)\.next\(\)\.value\)/);
});

test('filtered-equivalent multiscale stone demands share one realization', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const coordinate = [0.1875, -0.625];
  const coarse = sampleRockMaterialReference(field, coordinate, {
    detailLevel: 0,
    footprint: 0.5,
  });
  const filteredFine = sampleRockMaterialReference(field, coordinate, {
    detailLevel: 5,
    footprint: 0.5,
  });
  const visibleFine = sampleRockMaterialReference(field, coordinate, {
    detailLevel: 5,
    footprint: 0.01,
  });

  assert.strictEqual(filteredFine, coarse);
  assert.notStrictEqual(visibleFine, coarse);
  assert.notEqual(visibleFine.geology, coarse.geology);
});
