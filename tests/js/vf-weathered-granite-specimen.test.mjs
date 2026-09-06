import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWeatheredGraniteSpecimenReference,
} from '../../web/vf-ui/vf-weathered-granite-specimen.mjs';
import {
  realizeGraniteGranularProbeReference,
  realizeGraniteMicroreliefProbeReference,
} from '../../web/vf-ui/vf-granite-microrelief-reference.mjs';

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
  assert.ok(metrics.baseHeightSpan > 0.025);
  assert.ok(metrics.baseHeightSpan < 0.065);
  assert.ok(metrics.baseContactAngularBins >= 8);
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

test('microrelief changes only the material variant, never geometry bytes', () => {
  const baseline = createWeatheredGraniteSpecimenReference(IDENTITY, {
    microrelief: false,
  });
  const enabled = createWeatheredGraniteSpecimenReference(IDENTITY, {
    microrelief: true,
  });

  assert.deepEqual(enabled.packet.vertices, baseline.packet.vertices);
  assert.deepEqual(enabled.packet.indices, baseline.packet.indices);
  assert.equal(enabled.packet.vertices.byteLength, baseline.packet.vertices.byteLength);
  assert.equal(enabled.packet.indices.byteLength, baseline.packet.indices.byteLength);
  assert.deepEqual(
    enabled.packet.rock_material_gpu.streamWords,
    baseline.packet.rock_material_gpu.streamWords,
  );
  assert.equal(baseline.packet.rock_material_gpu.variant, 'weathered-granite');
  assert.equal(enabled.packet.rock_material_gpu.variant, 'weathered-granite-microrelief');
});

test('conditioned microrelief is deterministic, directional, bounded, and filtered', () => {
  const options = { resolution: 48, footprint: 0.002 };
  const lightA = [0.35, -0.42, 0.84];
  const lightB = [-0.61, 0.19, 0.77];
  const first = realizeGraniteMicroreliefProbeReference(IDENTITY, {
    ...options,
    lightDirection: lightA,
    enabled: true,
  });
  const replay = realizeGraniteMicroreliefProbeReference(IDENTITY, {
    ...options,
    lightDirection: lightA,
    enabled: true,
  });
  const relit = realizeGraniteMicroreliefProbeReference(IDENTITY, {
    ...options,
    lightDirection: lightB,
    enabled: true,
  });
  const disabled = realizeGraniteMicroreliefProbeReference(IDENTITY, {
    ...options,
    lightDirection: lightA,
    enabled: false,
  });
  const distant = realizeGraniteMicroreliefProbeReference(IDENTITY, {
    resolution: 24,
    footprint: 0.055,
    lightDirection: lightA,
    enabled: true,
  });

  assert.deepEqual(first, replay);
  assert.deepEqual(first.albedo, relit.albedo);
  assert.deepEqual(first.materialIdentity, relit.materialIdentity);
  assert.notDeepEqual(first.luminance, relit.luminance);
  assert.ok(first.highFrequencyLightingEnergy > disabled.highFrequencyLightingEnergy * 4);
  assert.ok(distant.highFrequencyLightingEnergy < first.highFrequencyLightingEnergy * 0.45);
  assert.ok(first.highlightSpan > 0.015);
  assert.ok(first.normalLengthError < 1e-6);
  assert.ok(first.maximumSlope <= 0.48);
  assert.ok(first.minimumRoughness >= 0.48);
  assert.ok(first.maximumRoughness <= 0.9);
  assert.ok([...first.luminance, ...first.highlight].every(Number.isFinite));
});

test('bounded horizon march creates directional grazing microshadows only', () => {
  const probe = (lightDirection, microshadow = true) => (
    realizeGraniteMicroreliefProbeReference(IDENTITY, {
      resolution: 48,
      footprint: 0.002,
      lightDirection,
      enabled: true,
      microshadow,
    })
  );
  const overhead = probe([0.1, 0.1, 0.99]);
  const left = probe([-0.96, 0, 0.28]);
  const right = probe([0.96, 0, 0.28]);
  const disabled = probe([-0.96, 0, 0.28], false);

  assert.equal(overhead.shadowedPixelFraction, 0);
  assert.equal(disabled.shadowedPixelFraction, 0);
  assert.ok(left.shadowedPixelFraction > 0.15);
  assert.ok(right.shadowedPixelFraction > 0.15);
  assert.ok(left.highFrequencyLightingEnergy > overhead.highFrequencyLightingEnergy * 1.15);
  assert.ok(right.highFrequencyLightingEnergy > overhead.highFrequencyLightingEnergy * 1.2);
  assert.ok(left.highFrequencyLightingEnergy > disabled.highFrequencyLightingEnergy * 2.4);
  assert.notDeepEqual(left.luminance, right.luminance);
  assert.deepEqual(left.albedo, right.albedo);
  assert.equal(left.maxHorizonSteps, 8);
});

test('R3 granular material stays isotropic and reverses local light-shadow pairs', () => {
  const probe = realizeGraniteGranularProbeReference(IDENTITY, {
    resolution: 64,
    footprint: 0.0015,
  });

  assert.ok(probe.orientationEnergyRatio < 1.28);
  assert.ok(probe.peakFraction > 0.04 && probe.peakFraction < 0.32);
  assert.ok(probe.pitFraction > 0.025 && probe.pitFraction < 0.24);
  assert.ok(probe.leftShadowFraction > 0.18);
  assert.ok(probe.rightShadowFraction > 0.18);
  assert.ok(probe.overheadShadowFraction < 0.035);
  assert.ok(probe.pairedReversalFraction > 0.32);
  assert.ok(probe.minimumRoughness >= 0.7);
  assert.ok(probe.maximumRoughness <= 0.93);
  assert.equal(probe.maximumHorizonSteps, 8);
});

test('R3 granular shader leaves baseline geometry byte-identical', () => {
  const baseline = createWeatheredGraniteSpecimenReference(IDENTITY);
  const granular = createWeatheredGraniteSpecimenReference(IDENTITY, {
    granularMicrorelief: true,
  });

  assert.deepEqual(granular.packet.vertices, baseline.packet.vertices);
  assert.deepEqual(granular.packet.indices, baseline.packet.indices);
  assert.equal(
    granular.packet.rock_material_gpu.variant,
    'weathered-granite-granular',
  );
});

test('R4 granite mineral populations are distinct, bounded, and light-independent', () => {
  const probe = realizeGraniteGranularProbeReference(IDENTITY, {
    resolution: 64,
    footprint: 0.0015,
  });

  assert.ok(probe.feldsparFraction > 0.18 && probe.feldsparFraction < 0.62);
  assert.ok(probe.quartzFraction > 0.08 && probe.quartzFraction < 0.42);
  assert.ok(probe.micaFraction > 0.003 && probe.micaFraction < 0.04);
  assert.ok(probe.mineralAlbedoSpan > 0.16);
  assert.ok(probe.mineralChromaSpan > 0.045);
  assert.ok(probe.minimumMineralRoughness >= 0.64);
  assert.ok(probe.maximumMineralRoughness <= 0.93);
  assert.ok(probe.mineralRoughnessSpan > 0.12);
  assert.equal(probe.mineralFieldDependsOnLight, false);
});

test('R5 mineral domains have bounded angular crystalline breakup and readable cavities', () => {
  const probe = realizeGraniteGranularProbeReference(IDENTITY, {
    resolution: 64,
    footprint: 0.0015,
  });

  assert.ok(probe.crystalEdgeFraction > 0.08 && probe.crystalEdgeFraction < 0.34);
  assert.ok(probe.mineralTransitionDensity > 0.22);
  assert.ok(probe.maximumMineralRun <= 20);
  assert.ok(probe.fineCrystalFraction > 0.12 && probe.fineCrystalFraction < 0.58);
  assert.ok(probe.minimumCavityBounceLuminance > 0.075);
  assert.ok(probe.maximumCavityBounceLuminance < 0.36);
  assert.ok(probe.microFeatureDensityRatio > 4 && probe.microFeatureDensityRatio < 8.5);
  assert.ok(probe.microMedianProjectedRadius < probe.mesoMedianProjectedRadius * 0.38);
  assert.ok(probe.microMedianProjectedRadius > probe.mesoMedianProjectedRadius * 0.18);
  assert.ok(probe.microShadowReversalFraction > 0.25);
  assert.equal(probe.microBandAffectsHeight, true);
});
