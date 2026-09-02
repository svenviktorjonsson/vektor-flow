import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_SAMPLE_BUDGET = 65536;
const PAINT_COLOR = Object.freeze([0.78, 0.76, 0.68]);

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function requireRoadWear(workingSet) {
  if (
    !workingSet
    || workingSet.kind !== 'road-wear-working-set:v1'
    || !(workingSet.drivers instanceof Float32Array)
    || workingSet.drivers.length !== workingSet.sampleCount * 2
    || !(workingSet.geometry?.coordinates instanceof Float32Array)
    || !(workingSet.geometry?.positions instanceof Float32Array)
    || !(workingSet.geometry?.layerIndices instanceof Uint16Array)
    || !(workingSet.material?.albedo instanceof Float32Array)
    || !(workingSet.material?.roughness instanceof Float32Array)
    || !(workingSet.material?.wetness instanceof Float32Array)
    || workingSet.geometry.coordinates !== workingSet.material.coordinates
    || workingSet.geometry.positions !== workingSet.material.positions
    || workingSet.geometry.layerIndices !== workingSet.material.layerIndices
    || workingSet.geometry.coordinates.length !== workingSet.sampleCount * 3
    || workingSet.geometry.positions.length !== workingSet.sampleCount * 3
    || workingSet.geometry.layerIndices.length !== workingSet.sampleCount
    || workingSet.material.albedo.length !== workingSet.sampleCount * 3
    || workingSet.material.roughness.length !== workingSet.sampleCount
    || workingSet.material.wetness.length !== workingSet.sampleCount
    || !Number.isSafeInteger(workingSet.potentialCellCount)
  ) {
    throw new TypeError('road wear working set is required');
  }
}

function requireBudget(sampleBudget) {
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_SAMPLE_BUDGET
  ) {
    throw new RangeError(
      `road marking sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

function dashedCenterMask(longitudinal, lateral, layerIndex) {
  if (layerIndex !== 0 || Math.abs(lateral) > 0.075) return 0;
  const phase = ((longitudinal % 6) + 6) % 6;
  return phase < 3 ? 1 : 0;
}

export function createRoadMarkingFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-marking-field:v1' });
  fieldState.set(field, Object.freeze({
    flakes: conditionChild(root, {
      segment: 'road-field:marking-flakes',
      channel: 'paint-retention',
    }),
  }));
  return field;
}

export function realizeRoadMarkingCellsReference(
  field,
  roadWear,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road marking field is required');
  requireRoadWear(roadWear);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadWear.sampleCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadWear.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadWear.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadWear.geometry.layerIndices.subarray(0, sampleCount);
  const flakeDriver = new Float32Array(sampleCount);
  const paintCoverage = new Float32Array(sampleCount);
  const paintHeight = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);
  const wetness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    const longitudinal = coordinates[coordinateOffset];
    const lateral = coordinates[coordinateOffset + 1];
    flakeDriver[sample] = sampleSpatialCorrelation2Reference(
      state.flakes,
      [longitudinal, lateral],
      { correlationLength: 0.3, mean: 0, amplitude: 1 },
    );
    const traffic = roadWear.drivers[sample * 2];
    const exposure = roadWear.drivers[sample * 2 + 1];
    const wear = clamp01(0.5 + traffic * 0.35 + exposure * 0.15);
    const mask = dashedCenterMask(longitudinal, lateral, layerIndices[sample]);
    const coverage = mask * clamp01(0.92 - wear * 0.45 + flakeDriver[sample] * 0.08);
    paintCoverage[sample] = coverage;
    paintHeight[sample] = coverage * 0.0015;
    roughness[sample] = roadWear.material.roughness[sample]
      + coverage * (0.58 - roadWear.material.roughness[sample]);
    wetness[sample] = roadWear.material.wetness[sample] * (1 - coverage * 0.12);

    const colorOffset = sample * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[colorOffset + channel] = roadWear.material.albedo[colorOffset + channel]
        + coverage * (
          PAINT_COLOR[channel] - roadWear.material.albedo[colorOffset + channel]
        );
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    paintCoverage,
    paintHeight,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    paintCoverage,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-marking-working-set:v1',
    sampleCount,
    potentialCellCount: roadWear.potentialCellCount,
    flakeDriver,
    geometry,
    material,
    vectorBytes: flakeDriver.byteLength + paintCoverage.byteLength
      + paintHeight.byteLength + albedo.byteLength + roughness.byteLength
      + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadWear.sampleCount,
  });
}
