import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const BAND_WAVELENGTHS = Object.freeze([0.045, 0.0225, 0.01125]);
const BAND_AMPLITUDES = Object.freeze([0.008, 0.0042, 0.0021]);
const MAX_HORIZON_STEPS = 8;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const normalize = (value) => {
  const length = Math.hypot(...value);
  if (!(length > 1e-12)) throw new RangeError('microrelief direction must be non-zero');
  return value.map((component) => component / length);
};

function filterWeight(wavelength, footprint) {
  if (footprint <= wavelength * 0.42) return 1;
  if (footprint >= wavelength) return 0;
  const ratio = (wavelength - footprint) / (wavelength * 0.58);
  return ratio * ratio * (3 - 2 * ratio);
}

function nodeFor(identity) {
  const form = conditionChild(createConditionedRoot(identity), {
    segment: 'stone:weathered-granite:v1',
    channel: 'shared-geology-form',
  });
  return conditionChild(form, {
    segment: 'stone:weathered-granite:surface',
    channel: 'mineral-fracture-weathering',
  });
}

function heightAt(node, coordinates, footprint) {
  return BAND_WAVELENGTHS.reduce((height, wavelength, band) => (
    height + BAND_AMPLITUDES[band] * filterWeight(wavelength, footprint)
      * sampleSpatialCorrelation2Reference(node, coordinates, {
        correlationLength: wavelength,
        mean: 0,
        amplitude: 1,
      })
  ), 0);
}

function sampleAt(node, coordinates, footprint, enabled) {
  if (!enabled) return { height: 0, slope: [0, 0], normal: [0, 0, 1], roughness: 0.7 };
  const step = 0.0007;
  const height = heightAt(node, coordinates, footprint);
  const slope = [
    (heightAt(node, [coordinates[0] + step, coordinates[1]], footprint)
      - heightAt(node, [coordinates[0] - step, coordinates[1]], footprint)) / (2 * step),
    (heightAt(node, [coordinates[0], coordinates[1] + step], footprint)
      - heightAt(node, [coordinates[0], coordinates[1] - step], footprint)) / (2 * step),
  ].map((value) => clamp(value * 0.12, -0.48, 0.48));
  const normal = normalize([-slope[0], -slope[1], 1]);
  const roughnessNoise = sampleSpatialCorrelation2Reference(
    node,
    [coordinates[0] + 11.7, coordinates[1] - 6.2],
    { correlationLength: 0.028, mean: 0, amplitude: filterWeight(0.028, footprint) },
  );
  return {
    height,
    slope,
    normal,
    roughness: clamp(0.69 + roughnessNoise * 0.13, 0.48, 0.9),
  };
}

function horizonVisibility(node, coordinates, footprint, light, enabled) {
  if (!enabled) return 1;
  const horizontal = Math.hypot(light[0], light[1]);
  const incidence = Math.max(light[2], 0);
  const incidenceGate = clamp((incidence - 0.04) / 0.10, 0, 1);
  const fade = incidenceGate * (1 - clamp((incidence - 0.28) / 0.58, 0, 1))
    * filterWeight(BAND_WAVELENGTHS[0], footprint);
  if (!(horizontal > 1e-6) || !(fade > 0)) return 1;
  const direction = [light[0] / horizontal, light[1] / horizontal];
  const origin = heightAt(node, coordinates, footprint);
  const distance = Math.max(0.0018, footprint * 1.05);
  for (let step = 1; step <= MAX_HORIZON_STEPS; step += 1) {
    const travel = distance * step;
    const terrain = heightAt(node, [
      coordinates[0] + direction[0] * travel,
      coordinates[1] + direction[1] * travel,
    ], footprint);
    const ray = origin + travel * incidence / Math.max(horizontal, 0.08);
    if (terrain > ray + 0.00005) return 1 - 0.86 * fade;
  }
  return 1;
}

function adjacentEnergy(values, resolution) {
  let total = 0;
  let count = 0;
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = y * resolution + x;
      if (x + 1 < resolution) { total += Math.abs(values[index] - values[index + 1]); count += 1; }
      if (y + 1 < resolution) { total += Math.abs(values[index] - values[index + resolution]); count += 1; }
    }
  }
  return total / count;
}

export function realizeGraniteMicroreliefProbeReference(identity, {
  resolution,
  footprint,
  lightDirection,
  enabled,
  microshadow = true,
}) {
  if (!Number.isSafeInteger(resolution) || resolution < 8 || resolution > 128) {
    throw new RangeError('granite microrelief probe resolution must be from 8 through 128');
  }
  if (!Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('granite microrelief footprint must be finite and non-negative');
  }
  const light = normalize(lightDirection);
  const node = nodeFor(identity);
  const albedo = new Float32Array(resolution * resolution);
  const luminance = new Float32Array(resolution * resolution);
  const highlight = new Float32Array(resolution * resolution);
  let maximumSlope = 0;
  let normalLengthError = 0;
  let minimumRoughness = 1;
  let maximumRoughness = 0;
  let shadowed = 0;
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = y * resolution + x;
      const coordinates = [(x + 0.5) / resolution, (y + 0.5) / resolution];
      const broad = sampleSpatialCorrelation2Reference(node, coordinates, {
        correlationLength: 0.24, mean: 0, amplitude: 1,
      });
      const base = clamp(0.56 + broad * 0.065, 0.42, 0.72);
      const sample = sampleAt(node, coordinates, footprint, enabled);
      const visibility = horizonVisibility(
        node, coordinates, footprint, light, enabled && microshadow,
      );
      const diffuse = Math.max(0, sample.normal[0] * light[0]
        + sample.normal[1] * light[1] + sample.normal[2] * light[2]);
      const half = normalize([light[0], light[1], light[2] + 1]);
      const specular = ((1 - sample.roughness) ** 2)
        * (Math.max(0, sample.normal[0] * half[0]
          + sample.normal[1] * half[1] + sample.normal[2] * half[2]) ** 24);
      albedo[index] = base;
      luminance[index] = base * 0.2 + visibility * (base * diffuse * 0.8 + specular);
      highlight[index] = visibility * specular;
      shadowed += visibility < 0.99 ? 1 : 0;
      maximumSlope = Math.max(maximumSlope, Math.hypot(...sample.slope));
      normalLengthError = Math.max(normalLengthError, Math.abs(Math.hypot(...sample.normal) - 1));
      minimumRoughness = Math.min(minimumRoughness, sample.roughness);
      maximumRoughness = Math.max(maximumRoughness, sample.roughness);
    }
  }
  return Object.freeze({
    kind: 'granite-microrelief-probe:v1',
    materialIdentity: Object.freeze([...identity.seed, ...identity.hierarchy]),
    albedo,
    luminance,
    highlight,
    highFrequencyLightingEnergy: adjacentEnergy(Array.from(luminance, (value, index) => (
      value / Math.max(albedo[index], 1e-6)
    )), resolution),
    highlightSpan: Math.max(...highlight) - Math.min(...highlight),
    shadowedPixelFraction: shadowed / luminance.length,
    maximumSlope,
    normalLengthError,
    minimumRoughness,
    maximumRoughness,
    maxHorizonSteps: MAX_HORIZON_STEPS,
  });
}

function granularNoise3(node, position, wavelength, salt) {
  const xy = sampleSpatialCorrelation2Reference(
    node, [position[0] + salt, position[1] - salt * 0.37],
    { correlationLength: wavelength, mean: 0, amplitude: 1 },
  );
  const yz = sampleSpatialCorrelation2Reference(
    node, [position[1] + salt * 1.7, position[2] + salt * 0.61],
    { correlationLength: wavelength, mean: 0, amplitude: 1 },
  );
  const zx = sampleSpatialCorrelation2Reference(
    node, [position[2] - salt * 0.83, position[0] + salt * 1.13],
    { correlationLength: wavelength, mean: 0, amplitude: 1 },
  );
  return (xy + yz + zx) / Math.sqrt(3);
}

function granularHeight(node, position, footprint) {
  const broad = 0.0035 * filterWeight(0.052, footprint)
    * granularNoise3(node, position, 0.052, 2.3);
  const grain = granularNoise3(node, position, 0.025, 7.1);
  const fine = granularNoise3(node, position, 0.0125, 13.7);
  const peak = Math.max(0, grain - 0.20) ** 2 * 0.012;
  const pit = Math.max(0, -fine - 0.38) ** 2 * 0.009;
  return broad
    + filterWeight(0.025, footprint) * (0.0045 * grain + peak)
    + filterWeight(0.0125, footprint) * (0.0012 * fine - pit);
}

function granularHorizon(
  node,
  position,
  footprint,
  tangentDirection,
  incidence,
) {
  const origin = granularHeight(node, position, footprint);
  const travelStep = Math.max(0.0030, footprint * 1.20);
  for (let step = 1; step <= MAX_HORIZON_STEPS; step += 1) {
    const travel = step * travelStep;
    const sample = position.map((value, axis) => (
      value + tangentDirection[axis] * travel
    ));
    if (
      granularHeight(node, sample, footprint)
      > origin + travel * incidence / 1.85 + 0.00005
    ) return true;
  }
  return false;
}

export function realizeGraniteGranularProbeReference(identity, {
  resolution,
  footprint,
}) {
  if (!Number.isSafeInteger(resolution) || resolution < 8 || resolution > 128) {
    throw new RangeError('granite granular probe resolution must be from 8 through 128');
  }
  if (!Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('granite granular footprint must be finite and non-negative');
  }
  const node = nodeFor(identity);
  const gradientEnergies = [0, 0, 0, 0];
  let peakCount = 0;
  let pitCount = 0;
  let leftShadows = 0;
  let rightShadows = 0;
  let overheadShadows = 0;
  let pairedReversals = 0;
  let minimumRoughness = 1;
  let maximumRoughness = 0;
  const directions = [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];
  const derivativeStep = 0.0007;
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const position = [
        (x + 0.5) / resolution,
        (y + 0.5) / resolution,
        0.31 + 0.07 * Math.sin((x + y * 0.37) / resolution * Math.PI * 2),
      ];
      const height = granularHeight(node, position, footprint);
      const derivative = [0, 1, 2].map((axis) => {
        const plus = [...position];
        const minus = [...position];
        plus[axis] += derivativeStep;
        minus[axis] -= derivativeStep;
        return (granularHeight(node, plus, footprint)
          - granularHeight(node, minus, footprint)) / (2 * derivativeStep);
      });
      directions.forEach((direction, index) => {
        gradientEnergies[index] += Math.abs(
          derivative[0] * direction[0] + derivative[1] * direction[1],
        );
      });
      const left = granularHorizon(node, position, footprint, [-1, 0, 0], 0.20);
      const right = granularHorizon(node, position, footprint, [1, 0, 0], 0.20);
      const overhead = granularHorizon(node, position, footprint, [1, 0, 0], 1.4);
      leftShadows += left ? 1 : 0;
      rightShadows += right ? 1 : 0;
      overheadShadows += overhead ? 1 : 0;
      pairedReversals += left !== right ? 1 : 0;
      peakCount += height > 0.0045 ? 1 : 0;
      pitCount += height < -0.0042 ? 1 : 0;
      const roughness = clamp(
        0.80 + granularNoise3(node, position, 0.030, 19.1) * 0.075,
        0.70,
        0.93,
      );
      minimumRoughness = Math.min(minimumRoughness, roughness);
      maximumRoughness = Math.max(maximumRoughness, roughness);
    }
  }
  const count = resolution * resolution;
  const minimumOrientationEnergy = Math.min(...gradientEnergies);
  return Object.freeze({
    kind: 'granite-granular-probe:v1',
    orientationEnergyRatio: Math.max(...gradientEnergies) / minimumOrientationEnergy,
    peakFraction: peakCount / count,
    pitFraction: pitCount / count,
    leftShadowFraction: leftShadows / count,
    rightShadowFraction: rightShadows / count,
    overheadShadowFraction: overheadShadows / count,
    pairedReversalFraction: pairedReversals / count,
    minimumRoughness,
    maximumRoughness,
    maximumHorizonSteps: MAX_HORIZON_STEPS,
  });
}
