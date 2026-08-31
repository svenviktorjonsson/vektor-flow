import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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
  cells: Object.freeze(Array.from({ length: 512 }, (_, index) => (
    Object.freeze([index % 32, Math.floor(index / 32)])
  ))),
  detailLevel: 0,
  footprint: 0,
  bladeBudget: 512,
});

test('grass keeps one bounded LRU of realized demanded cell material', () => {
  assert.match(source, /const MAX_CACHED_CELL_MATERIALS = MAX_DEMANDED_CELLS/);
  assert.match(source, /cellMaterialCache: new Map\(\)/);
  assert.match(source, /cellMaterialCache\.keys\(\)\.next\(\)\.value/);
  assert.match(source, /cellMaterialCache\.size > MAX_CACHED_CELL_MATERIALS/);
});

test('repeated demand reuses deterministic cell material realization', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const startedCold = performance.now();
  const cold = createGrassRendererGpuBatchPacketsReference(field, DEMAND);
  const coldMs = performance.now() - startedCold;

  let warm = null;
  let warmMinMs = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run += 1) {
    const startedWarm = performance.now();
    warm = createGrassRendererGpuBatchPacketsReference(field, DEMAND);
    warmMinMs = Math.min(warmMinMs, performance.now() - startedWarm);
  }

  assert.deepEqual(
    [...warm.packets[0].grass_gpu.cell_records],
    [...cold.packets[0].grass_gpu.cell_records],
  );
  assert.ok(
    warmMinMs < coldMs * 0.5,
    `warm ${warmMinMs.toFixed(2)} ms must be less than half cold ${coldMs.toFixed(2)} ms`,
  );
});
