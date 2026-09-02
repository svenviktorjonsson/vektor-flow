import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_SAMPLE_BUDGET = 65536;
const SNOW_COLOR = Object.freeze([0.9, 0.93, 0.96]);

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
      `road snow sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadSnowFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-snow-field:v1' });
  fieldState.set(field, Object.freeze({
    drift: conditionChild(root, {
      segment: 'road-field:snow-drift',
      channel: 'snow-coverage',
    }),
  }));
  return field;
}

export function realizeRoadSnowCellsReference(
  field,
  roadWear,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road snow field is required');
  requireRoadWear(roadWear);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadWear.sampleCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadWear.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadWear.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadWear.geometry.layerIndices.subarray(0, sampleCount);
  const driftDriver = new Float32Array(sampleCount);
  const snowCoverage = new Float32Array(sampleCount);
  const snowDepth = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);
  const wetness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    const longitudinal = coordinates[coordinateOffset];
    const lateral = coordinates[coordinateOffset + 1];
    driftDriver[sample] = sampleSpatialCorrelation2Reference(
      state.drift,
      [longitudinal, lateral],
      { correlationLength: 4, mean: 0, amplitude: 1 },
    );
    const traffic = roadWear.drivers[sample * 2];
    const exposure = roadWear.drivers[sample * 2 + 1];
    const trafficLoad = clamp01(0.5 + traffic * 0.6);
    const shelter = clamp01(0.5 - exposure * 0.4);
    const edgeDrift = clamp01((Math.abs(lateral) - 2.5) / 2);
    const surface = layerIndices[sample] === 0 ? 1 : 0;
    const coverage = surface * clamp01(
      0.65
        + driftDriver[sample] * 0.15
        + edgeDrift * 0.25
        - trafficLoad * 0.35
        + shelter * 0.1,
    );
    snowCoverage[sample] = coverage;
    snowDepth[sample] = coverage * (0.008 + edgeDrift * 0.012);
    roughness[sample] = roadWear.material.roughness[sample]
      + coverage * (0.88 - roadWear.material.roughness[sample]);
    wetness[sample] = clamp01(
      roadWear.material.wetness[sample] + coverage * 0.1,
    );

    const colorOffset = sample * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[colorOffset + channel] = roadWear.material.albedo[colorOffset + channel]
        + coverage * (
          SNOW_COLOR[channel] - roadWear.material.albedo[colorOffset + channel]
        );
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    snowCoverage,
    snowDepth,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    snowCoverage,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-snow-working-set:v1',
    sampleCount,
    potentialCellCount: roadWear.potentialCellCount,
    driftDriver,
    geometry,
    material,
    vectorBytes: driftDriver.byteLength + snowCoverage.byteLength
      + snowDepth.byteLength + albedo.byteLength + roughness.byteLength
      + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadWear.sampleCount,
  });
}
