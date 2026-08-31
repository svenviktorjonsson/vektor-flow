import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGrassMaterialFieldReference,
  createGrassRendererBatchPacketsReference,
  createGrassRendererGpuBatchPacketsReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';
import {
  reconstructGrassBladeGpuInstancesReference,
} from '../../web/vf-ui/vf-grass-blade-gpu.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:distance-material'],
  lod: 0,
  channel: 'surface',
});

const DEMAND = Object.freeze({
  cells: Object.freeze([Object.freeze([2, -1])]),
  detailLevel: 4,
  bladeBudget: 16,
});

function instancesAt(field, footprint) {
  return createGrassRendererBatchPacketsReference(field, {
    ...DEMAND,
    footprint,
  }).packets[0].instances;
}

function close(actual, expected, tolerance = 2e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
}

test('projected footprint smoothly refines grass color and roughness without moving blades', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const coarse = instancesAt(field, 1 / 16);
  const transition = instancesAt(field, 3 / 64);
  const fine = instancesAt(field, 1 / 32);

  assert.notDeepEqual([...fine], [...coarse]);
  for (let blade = 0; blade < DEMAND.bladeBudget; blade += 1) {
    const offset = blade * 16;
    for (const lane of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 15]) {
      assert.equal(fine[offset + lane], coarse[offset + lane]);
      assert.equal(transition[offset + lane], coarse[offset + lane]);
    }
    for (const lane of [7, 12, 13, 14]) {
      close(
        transition[offset + lane],
        (coarse[offset + lane] + fine[offset + lane]) / 2,
      );
    }
  }
});

test('GPU reconstruction preserves the filtered CPU material with fixed record bounds', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const demand = { ...DEMAND, footprint: 3 / 64 };
  const cpu = createGrassRendererBatchPacketsReference(field, demand).packets[0];
  const gpu = createGrassRendererGpuBatchPacketsReference(field, demand).packets[0];
  const reconstructed = reconstructGrassBladeGpuInstancesReference(
    gpu.grass_gpu,
    gpu.instance_count,
  );

  assert.equal(gpu.grass_gpu.cell_stride_words, 12);
  assert.equal(gpu.grass_gpu.cell_records.byteLength, 48);
  assert.equal(reconstructed.length, cpu.instances.length);
  for (let index = 0; index < reconstructed.length; index += 1) {
    close(reconstructed[index], cpu.instances[index]);
  }
});
