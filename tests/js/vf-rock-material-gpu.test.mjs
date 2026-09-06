import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  adaptRockMaterialToRendererPacketReference,
  createRockMaterialFieldReference,
  createRockMaterialGpuDescriptorReference,
  sampleRockMaterialReference,
} from '../../web/vf-ui/vf-rock-material-field.mjs';
import {
  ROCK_MATERIAL_WGSL,
  createRockMaterialGpuParityFixture,
  verifyRockMaterialGpuParity,
} from '../../web/vf-ui/vf-rock-material-gpu.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.procedural',
  version: 1,
  seed: Object.freeze([0x12345678, 0x9abcdef0]),
  domain: 'material',
  hierarchy: Object.freeze(['world:alpine', 'rock:gpu-parity']),
  lod: 0,
  channel: 'geology',
});

test('retained rock packet carries a compact GPU field descriptor without changing identity', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const source = Object.freeze({
    id: 'rock:detail:face:2',
    object_id: 42,
    type: 'field_mesh',
    vertices: new Float32Array([
      3, 0, 0, 1, 0, 0, 0.4, 0.3, 0.2, 1,
      0, 2, 0, 0, 1, 0, 0.4, 0.3, 0.2, 1,
      0, 0, 1.5, 0, 0, 1, 0.4, 0.3, 0.2, 1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
  });
  const adapted = adaptRockMaterialToRendererPacketReference(source, field, {
    radii: [3, 2, 1.5],
    detailLevel: 5,
    footprint: 0.04,
  });

  assert.equal(adapted.id, source.id);
  assert.equal(adapted.object_id, source.object_id);
  assert.equal(adapted.indices, source.indices);
  assert.equal(adapted.rock_material_gpu.kind, 'rock-geology-weathering-gpu:v1');
  assert.deepEqual(adapted.rock_material_gpu.radii, [3, 2, 1.5]);
  assert.equal(adapted.rock_material_gpu.detailLevel, 5);
  assert.equal(adapted.rock_material_gpu.maxOctaves, 6);
});

test('rock GPU parity verifier enforces channel-specific numerical bounds', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const descriptor = createRockMaterialGpuDescriptorReference(field, {
    radii: [3, 2, 1.5],
    detailLevel: 5,
  });
  const surfaceCoordinates = [0.125, -0.375];
  const footprint = 0.01;
  const fixture = createRockMaterialGpuParityFixture([{
    descriptor,
    surfaceCoordinates,
    footprint,
    expected: sampleRockMaterialReference(field, surfaceCoordinates, {
      detailLevel: descriptor.detailLevel,
      footprint,
    }),
  }]);

  assert.deepEqual(verifyRockMaterialGpuParity(fixture, fixture.expected), {
    matched: true,
    records: 1,
    maxAbsoluteError: 0,
  });
  const corrupted = fixture.expected.slice();
  corrupted[2] += 0.01;
  assert.deepEqual(verifyRockMaterialGpuParity(fixture, corrupted), {
    matched: false,
    record: 0,
    lane: 2,
    expected: fixture.expected[2],
    actual: corrupted[2],
    tolerance: 0.0002,
  });
});

test('headless fixture executes the rock material field through WebGPU', async () => {
  const html = await readFile(
    new URL('../fixtures/rock-material-gpu-parity-smoke.html', import.meta.url),
    'utf8',
  );
  assert.match(html, /createComputePipelineAsync/);
  assert.match(html, /vf_rock_parity_main/);
  assert.match(html, /mapAsync\(GPUMapMode\.READ\)/);
  assert.match(html, /verifyRockMaterialGpuParity/);
  assert.match(html, /__rockMaterialGpuParityEvidence/);
});

test('main receiver shader evaluates filtered rock channels per fragment', async () => {
  const rendererSource = await readFile(
    new URL('../../web/vf-ui/geom/vf-geom-wgpu.js', import.meta.url),
    'utf8',
  );
  assert.match(rendererSource, /import\(runtimeAssetUrl\("\.\.\/vf-rock-material-gpu\.mjs"\)\)/);
  assert.match(rendererSource, /rock_material_stream\s*:\s*vec4<u32>/);
  assert.match(rendererSource, /rock_material_radii_enabled\s*:\s*vec4<f32>/);
  assert.match(rendererSource, /vf_rock_material_sample\(/);
  assert.match(rendererSource, /max\(length\(dpdx\(surfaceCoordinates\)\), length\(dpdy\(surfaceCoordinates\)\)\)/);
  assert.match(rendererSource, /0\.34 \* \(1\.0 - rock\.roughness\) \* \(1\.0 - rock\.roughness\)/);
  assert.match(rendererSource, /shadeLitBaseScaled\(rock\.base_color\.rgb,[\s\S]*rockSpecularScale\)/);
  assert.match(ROCK_MATERIAL_WGSL, /vf_granite_noise3/);
  assert.match(ROCK_MATERIAL_WGSL, /position\.xy[\s\S]*position\.yz[\s\S]*position\.zx/);
  assert.match(ROCK_MATERIAL_WGSL, /vf_granite_granular_gradient/);
  assert.match(ROCK_MATERIAL_WGSL, /stepIndex <= 8u/);
  assert.match(rendererSource, /vf_stone_species_granular_visibility/);
  assert.match(ROCK_MATERIAL_WGSL, /feldspar/);
  assert.match(ROCK_MATERIAL_WGSL, /quartz/);
  assert.match(ROCK_MATERIAL_WGSL, /mica/);
  assert.match(rendererSource, /cavityBounce/);
  assert.match(ROCK_MATERIAL_WGSL, /vf_granite_crystal_cell/);
  assert.match(ROCK_MATERIAL_WGSL, /crystalEdge/);
});

test('stone species controls the rendered relief normal and horizon response', async () => {
  const rendererSource = await readFile(
    new URL('../../web/vf-ui/geom/vf-geom-wgpu.js', import.meta.url),
    'utf8',
  );
  assert.match(ROCK_MATERIAL_WGSL, /vf_stone_species_relief_profile/);
  assert.match(ROCK_MATERIAL_WGSL, /vf_stone_species_granular_normal/);
  assert.match(ROCK_MATERIAL_WGSL, /vf_stone_species_granular_visibility/);
  assert.match(rendererSource, /vf_stone_species_granular_normal\(/);
  assert.match(rendererSource, /vf_stone_species_granular_visibility\(/);
});

test('rock GPU fixture packs the exact conditioned stream and CPU material oracle', () => {
  const field = createRockMaterialFieldReference(IDENTITY);
  const descriptor = createRockMaterialGpuDescriptorReference(field, {
    radii: [3, 2, 1.5],
    detailLevel: 5,
    minimumFootprint: 0,
  });
  const surfaceCoordinates = [0.125, -0.375];
  const footprint = 0.01;
  const expected = sampleRockMaterialReference(field, surfaceCoordinates, {
    detailLevel: descriptor.detailLevel,
    footprint,
  });
  const fixture = createRockMaterialGpuParityFixture([{
    descriptor,
    surfaceCoordinates,
    footprint,
    expected,
  }]);

  assert.equal(descriptor.maxOctaves, 6);
  assert.deepEqual([...fixture.inputWords.slice(4, 8)], descriptor.streamWords);
  assert.deepEqual([...fixture.expected.slice(0, 4)], [...new Float32Array([
    expected.geology,
    expected.weathering,
    expected.roughness,
    expected.displacement,
  ])]);
  assert.equal(fixture.inputStrideWords, 8);
  assert.equal(fixture.outputStrideFloats, 16);
  assert.match(ROCK_MATERIAL_WGSL, /for \(var octave = 0u; octave < 6u;/);
  assert.match(fixture.source, /@compute\s+@workgroup_size\(64\)/);
});
