import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
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
