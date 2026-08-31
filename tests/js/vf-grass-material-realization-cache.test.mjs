import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createGrassMaterialFieldReference,
  createGrassRendererGpuBatchPacketsReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';

const source = await readFile(
  new URL('../../web/vf-ui/vf-grass-material-field.mjs', import.meta.url),
  'utf8',
);

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:cache'],
  lod: 0,
  channel: 'surface',
});

const DEMAND = Object.freeze({
  cells: Object.freeze([
    Object.freeze([0, 0]),
    Object.freeze([1, 0]),
    Object.freeze([0, 1]),
    Object.freeze([1, 1]),
  ]),
  detailLevel: 0,
  footprint: 0,
  bladeBudget: 4,
});

test('grass keeps two bounded adjacent views of realized cell material', () => {
  assert.match(source, /const MAX_CACHED_CELL_MATERIALS = MAX_DEMANDED_CELLS \* 2/);
  assert.match(source, /cellMaterialCache: new Map\(\)/);
  assert.match(source, /cellMaterialCache\.keys\(\)\.next\(\)\.value/);
  assert.match(source, /cellMaterialCache\.size > MAX_CACHED_CELL_MATERIALS/);
});

test('repeated demand reuses deterministic cell material realization', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const cold = createGrassRendererGpuBatchPacketsReference(field, DEMAND);
  const warm = createGrassRendererGpuBatchPacketsReference(field, DEMAND);

  assert.deepEqual(
    [...warm.packets[0].grass_gpu.cell_records],
    [...cold.packets[0].grass_gpu.cell_records],
  );
});
