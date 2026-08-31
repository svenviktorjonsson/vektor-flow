import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGrassMaterialFieldReference,
  createGrassRendererBatchPacketsReference,
  createGrassRendererGpuBatchPacketsReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';
import {
  GRASS_BLADE_COMPUTE_WGSL,
  reconstructGrassBladeGpuInstancesReference,
} from '../../web/vf-ui/vf-grass-blade-gpu.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:gpu'],
  lod: 0,
  channel: 'surface',
});

const DEMAND = Object.freeze({
  cells: Object.freeze([
    Object.freeze([2, -1]),
    Object.freeze([3, -1]),
  ]),
  detailLevel: 4,
  footprint: 0.01,
  bladeBudget: 32,
});

test('grass compute WGSL owns Philox sampling and one 64-byte output record per blade', () => {
  assert.match(GRASS_BLADE_COMPUTE_WGSL, /fn vf_philox4x32_10\(/);
  assert.match(GRASS_BLADE_COMPUTE_WGSL, /struct VfGrassCell/);
  assert.match(GRASS_BLADE_COMPUTE_WGSL, /struct VfGrassBladeInstance/);
  assert.match(GRASS_BLADE_COMPUTE_WGSL, /@compute @workgroup_size\(64\)/);
  assert.match(GRASS_BLADE_COMPUTE_WGSL, /vf_grass_blade_instances\[instance_index\]/);
  assert.match(GRASS_BLADE_COMPUTE_WGSL, /vec4<u32>\(cell\.counter_prefix, blade_index, lane\)/);
});

test('GPU descriptor reconstruction preserves the pinned CPU blade records', () => {
  const field = createGrassMaterialFieldReference(IDENTITY);
  const cpu = createGrassRendererBatchPacketsReference(field, DEMAND).packets[0];
  const gpu = createGrassRendererGpuBatchPacketsReference(field, DEMAND).packets[0];
  const reconstructed = reconstructGrassBladeGpuInstancesReference(
    gpu.grass_gpu,
    gpu.instance_count,
  );

  assert.equal(reconstructed.length, cpu.instances.length);
  for (let index = 0; index < reconstructed.length; index += 1) {
    assert.ok(
      Math.abs(reconstructed[index] - cpu.instances[index]) <= 2e-6,
      `record value ${index} differs: ${reconstructed[index]} vs ${cpu.instances[index]}`,
    );
  }
});
