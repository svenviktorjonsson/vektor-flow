import {
  conditionedNodeStreamReference,
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
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
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

function graniteMicroBump(node, position, footprint) {
  const micro = granularNoise3(node, position, 0.0045, 59.9);
  const peak = Math.max(0, micro - 0.05) ** 2 * 0.0022;
  return filterWeight(0.0045, footprint) * (micro * 0.00045 + peak);
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
    + filterWeight(0.0125, footprint) * (0.0012 * fine - pit)
    + graniteMicroBump(node, position, footprint);
}

function measuredPeakStats(node, wavelength, salt) {
  const size = 96;
  const span = 0.18;
  const values = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      values[y * size + x] = granularNoise3(
        node,
        [(x + 0.5) / size * span, (y + 0.5) / size * span, 0.31],
        wavelength,
        salt,
      );
    }
  }
  const peaks = [];
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const center = values[y * size + x];
      if (center < 0.08) continue;
      let maximum = true;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx !== 0 || dy !== 0) && values[(y + dy) * size + x + dx] >= center) {
            maximum = false;
          }
        }
      }
      if (maximum) peaks.push({ x, y, height: center });
    }
  }
  const radii = peaks.slice(0, 128).map((peak) => {
    const threshold = 0.08 + (peak.height - 0.08) * 0.5;
    let radius = 0;
    const directionCount = 8;
    for (let direction = 0; direction < directionCount; direction += 1) {
      const angle = direction / directionCount * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let crossing = wavelength;
      for (let step = 1; step <= 16; step += 1) {
        const distance = wavelength * step / 16;
        const value = granularNoise3(node, [
          (peak.x + 0.5) / size * span + dx * distance,
          (peak.y + 0.5) / size * span + dy * distance,
          0.31,
        ], wavelength, salt);
        if (value <= threshold) {
          crossing = distance;
          break;
        }
      }
      radius += crossing;
    }
    return radius / directionCount;
  });
  radii.sort((a, b) => a - b);
  return {
    count: peaks.length,
    medianRadius: radii[Math.floor(radii.length / 2)] ?? 0,
  };
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

function cellUniform(node, x, y, salt) {
  const stream = conditionedNodeStreamReference(node);
  let word = (stream.key[0] ^ stream.key[1] ^ stream.counterPrefix[0]
    ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)
    ^ Math.imul(Math.floor(salt * 101), 0xc2b2ae3d)) >>> 0;
  word ^= word >>> 16;
  word = Math.imul(word, 0x7feb352d) >>> 0;
  word ^= word >>> 15;
  return (word >>> 0) / 0x100000000;
}

function crystal2(node, position, wavelength, salt) {
  const scaled = position.map((value) => value / wavelength);
  const cell = scaled.map(Math.floor);
  const local = scaled.map((value, axis) => value - cell[axis]);
  let best = Infinity;
  let second = Infinity;
  let value = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const cx = cell[0] + ox;
      const cy = cell[1] + oy;
      const jitter = [cellUniform(node, cx, cy, salt), cellUniform(node, cx, cy, salt + 17.3)];
      const distance = (ox + jitter[0] - local[0]) ** 2
        + (oy + jitter[1] - local[1]) ** 2;
      if (distance < best) {
        second = best;
        best = distance;
        value = cellUniform(node, cx, cy, salt + 31.7) * 2 - 1;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  const gap = Math.sqrt(second) - Math.sqrt(best);
  return { value, edge: 1 - smoothstep(0.005, 0.030, gap) };
}

function graniteCrystalCell(node, position, wavelength, salt) {
  const xy = crystal2(node, [position[0] + position[2] * 0.37, position[1] - position[2] * 0.21], wavelength, salt);
  const yz = crystal2(node, [position[1] + position[0] * 0.29, position[2] - position[0] * 0.41], wavelength, salt + 7.9);
  return {
    value: (xy.value + yz.value) * Math.SQRT1_2,
    edge: Math.max(xy.edge, yz.edge * 0.8),
  };
}

function graniteMinerals(node, position, footprint) {
  const feldsparCell = graniteCrystalCell(node, position, 0.022, 23.7);
  const quartzCell = graniteCrystalCell(node, position, 0.016, 31.1);
  const mineralWeight = filterWeight(0.038, footprint);
  const feldspar = smoothstep(
    -0.20, 0.25,
    (granularNoise3(node, position, 0.038, 23.7) * 0.55
      + feldsparCell.value * 0.45) * mineralWeight,
  );
  const quartz = smoothstep(
    0.15, 0.48,
    (granularNoise3(node, position, 0.026, 31.1) * 0.58
      + quartzCell.value * 0.42) * filterWeight(0.026, footprint),
  );
  const mica = smoothstep(
    0.72, 0.94,
    granularNoise3(node, position, 0.009, 47.3) * filterWeight(0.009, footprint),
  );
  let color = [0.50, 0.485, 0.47];
  const mixColor = (target, amount) => {
    color = color.map((channel, index) => channel * (1 - amount) + target[index] * amount);
  };
  mixColor([0.72, 0.595, 0.53], feldspar * 0.62);
  mixColor([0.76, 0.75, 0.72], quartz * 0.66);
  mixColor([0.23, 0.24, 0.25], mica * 0.55);
  const crystalEdge = Math.max(feldsparCell.edge, quartzCell.edge * 0.82);
  mixColor([0.69, 0.675, 0.65], crystalEdge * 0.075);
  const roughNoise = granularNoise3(node, position, 0.030, 19.1)
    * filterWeight(0.030, footprint);
  const roughness = clamp(
    0.82 + roughNoise * 0.055 + feldspar * 0.025 - quartz * 0.15
      + mica * 0.045 + crystalEdge * 0.035,
    0.64,
    0.93,
  );
  const classification = mica > 0.5 ? 3 : (quartz > feldspar ? 2 : (feldspar > 0.38 ? 1 : 0));
  return {
    feldspar,
    quartz,
    mica,
    color,
    roughness,
    crystalEdge,
    fineCrystal: Math.abs(quartzCell.value) > 0.35,
    classification,
  };
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
  let feldsparCount = 0;
  let quartzCount = 0;
  let micaCount = 0;
  let minimumMineralAlbedo = 1;
  let maximumMineralAlbedo = 0;
  let minimumMineralChroma = 1;
  let maximumMineralChroma = 0;
  let minimumMineralRoughness = 1;
  let maximumMineralRoughness = 0;
  let crystalEdges = 0;
  let fineCrystals = 0;
  const mineralClasses = new Uint8Array(resolution * resolution);
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
      const mineral = graniteMinerals(node, position, footprint);
      feldsparCount += mineral.feldspar > 0.5 ? 1 : 0;
      quartzCount += mineral.quartz > 0.5 ? 1 : 0;
      micaCount += mineral.mica > 0.5 ? 1 : 0;
      const luminance = 0.2126 * mineral.color[0]
        + 0.7152 * mineral.color[1] + 0.0722 * mineral.color[2];
      const chroma = Math.max(...mineral.color) - Math.min(...mineral.color);
      minimumMineralAlbedo = Math.min(minimumMineralAlbedo, luminance);
      maximumMineralAlbedo = Math.max(maximumMineralAlbedo, luminance);
      minimumMineralChroma = Math.min(minimumMineralChroma, chroma);
      maximumMineralChroma = Math.max(maximumMineralChroma, chroma);
      minimumMineralRoughness = Math.min(minimumMineralRoughness, mineral.roughness);
      maximumMineralRoughness = Math.max(maximumMineralRoughness, mineral.roughness);
      crystalEdges += mineral.crystalEdge > 0.5 ? 1 : 0;
      fineCrystals += mineral.fineCrystal ? 1 : 0;
      mineralClasses[y * resolution + x] = mineral.classification;
    }
  }
  const count = resolution * resolution;
  const minimumOrientationEnergy = Math.min(...gradientEnergies);
  const microStats = measuredPeakStats(node, 0.0045, 59.9);
  const mesoStats = measuredPeakStats(node, 0.0125, 13.7);
  let transitions = 0;
  let transitionEdges = 0;
  let maximumMineralRun = 1;
  for (let y = 0; y < resolution; y += 1) {
    let run = 1;
    for (let x = 0; x < resolution; x += 1) {
      const index = y * resolution + x;
      if (x > 0) {
        transitionEdges += 1;
        if (mineralClasses[index] !== mineralClasses[index - 1]) {
          transitions += 1;
          run = 1;
        } else {
          run += 1;
          maximumMineralRun = Math.max(maximumMineralRun, run);
        }
      }
      if (y > 0) {
        transitionEdges += 1;
        transitions += mineralClasses[index] !== mineralClasses[index - resolution] ? 1 : 0;
      }
    }
  }
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
    feldsparFraction: feldsparCount / count,
    quartzFraction: quartzCount / count,
    micaFraction: micaCount / count,
    mineralAlbedoSpan: maximumMineralAlbedo - minimumMineralAlbedo,
    mineralChromaSpan: maximumMineralChroma - minimumMineralChroma,
    minimumMineralRoughness,
    maximumMineralRoughness,
    mineralRoughnessSpan: maximumMineralRoughness - minimumMineralRoughness,
    mineralFieldDependsOnLight: false,
    crystalEdgeFraction: crystalEdges / count,
    fineCrystalFraction: fineCrystals / count,
    mineralTransitionDensity: transitions / transitionEdges,
    maximumMineralRun,
    minimumCavityBounceLuminance: minimumMineralAlbedo * 0.42 + 0.014,
    maximumCavityBounceLuminance: maximumMineralAlbedo * 0.42 + 0.014,
    microFeatureDensityRatio: microStats.count / mesoStats.count,
    microMedianProjectedRadius: microStats.medianRadius,
    mesoMedianProjectedRadius: mesoStats.medianRadius,
    microShadowReversalFraction: pairedReversals / count,
    microBandAffectsHeight: true,
    maximumHorizonSteps: MAX_HORIZON_STEPS,
  });
}
