import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWeatheredGraniteSpecimenReference,
} from '../../web/vf-ui/vf-weathered-granite-specimen.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x243f6a88, 0x85a308d3]),
  domain: 'material',
  hierarchy: Object.freeze(['world:highland', 'stone:fieldstone-review']),
  lod: 0,
  channel: 'geology',
});

function edgeCounts(indices) {
  const counts = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = Array.from(indices.slice(offset, offset + 3));
    for (let edge = 0; edge < 3; edge += 1) {
      const ends = [triangle[edge], triangle[(edge + 1) % 3]].sort((a, b) => a - b);
      const key = `${ends[0]}:${ends[1]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

test('weathered granite specimen is bounded, closed, stable, and nondegenerate', () => {
  const specimen = createWeatheredGraniteSpecimenReference(IDENTITY);
  const { packet, metrics } = specimen;

  assert.equal(specimen.kind, 'weathered-granite-specimen:v1');
  assert.equal(packet.type, 'field_mesh');
  assert.equal(packet.rock_material_gpu.variant, 'weathered-granite');
  assert.ok(packet.vertices.length / 10 <= 4096);
  assert.ok(packet.indices.length / 3 <= 8192);
  assert.ok(specimen.vectorBytes <= 256 * 1024);
  assert.ok([...packet.vertices].every(Number.isFinite));
  assert.ok([...edgeCounts(packet.indices).values()].every((count) => count === 2));
  assert.ok(metrics.minimumTriangleArea > 1e-6);
  assert.equal(metrics.minimumZ, 0);
  assert.ok(metrics.baseVertexCount >= 12);
  assert.ok(metrics.supportRadius >= metrics.maximumRadius * 0.42);
  assert.ok(metrics.centerOfMassProjectionInsideSupport);
});

test('broad form is asymmetric with bounded fractures and softened chips', () => {
  const { metrics } = createWeatheredGraniteSpecimenReference(IDENTITY);

  assert.ok(metrics.radialCoefficientOfVariation > 0.09);
  assert.ok(metrics.radialCoefficientOfVariation < 0.34);
  assert.ok(metrics.oppositeSilhouetteAsymmetry > 0.08);
  assert.ok(metrics.maximumChipDepth > 0.04);
  assert.ok(metrics.maximumChipDepth < 0.24);
  assert.ok(metrics.maximumNeighborRadiusStep < 0.22);
  assert.ok(metrics.fractureCount >= 3 && metrics.fractureCount <= 7);
});

test('one geology identity deterministically couples shape and granite material', () => {
  const first = createWeatheredGraniteSpecimenReference(IDENTITY);
  const replay = createWeatheredGraniteSpecimenReference(IDENTITY);
  const varied = createWeatheredGraniteSpecimenReference({
    ...IDENTITY,
    seed: Object.freeze([IDENTITY.seed[0], IDENTITY.seed[1] + 1]),
  });

  assert.deepEqual(first.packet.vertices, replay.packet.vertices);
  assert.deepEqual(first.packet.indices, replay.packet.indices);
  assert.deepEqual(first.metrics, replay.metrics);
  assert.notDeepEqual(first.packet.vertices, varied.packet.vertices);
  assert.ok(first.metrics.albedoSpan > 0.22);
  assert.ok(first.metrics.roughnessSpan > 0.12);
  assert.ok(first.metrics.normalPerturbationSpan > 0.08);
  assert.ok(first.metrics.displacementSpan > 0.08);
  assert.ok(Math.abs(first.metrics.geologyMaterialCorrelation) > 0.35);
  assert.ok(first.metrics.mineralFleckFraction > 0.025);
  assert.ok(first.metrics.mineralFleckFraction < 0.24);
  assert.ok(first.metrics.crackFraction > 0.01);
  assert.ok(first.metrics.crackFraction < 0.16);
});
