import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_SAMPLE_BUDGET = 65536;
const PATCH_COLOR = Object.freeze([0.18, 0.17, 0.16]);

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function requireRoadCracks(workingSet) {
  if (
    !workingSet
    || workingSet.kind !== 'road-crack-working-set:v1'
    || !(workingSet.crackDriver instanceof Float32Array)
    || !(workingSet.geometry?.coordinates instanceof Float32Array)
    || !(workingSet.geometry?.positions instanceof Float32Array)
    || !(workingSet.geometry?.layerIndices instanceof Uint16Array)
    || !(workingSet.geometry?.crackCoverage instanceof Float32Array)
    || !(workingSet.geometry?.aperture instanceof Float32Array)
    || !(workingSet.geometry?.displacement instanceof Float32Array)
    || !(workingSet.material?.albedo instanceof Float32Array)
    || !(workingSet.material?.roughness instanceof Float32Array)
    || !(workingSet.material?.wetness instanceof Float32Array)
    || workingSet.geometry.crackCoverage !== workingSet.material.crackCoverage
    || workingSet.geometry.coordinates !== workingSet.material.coordinates
    || workingSet.geometry.positions !== workingSet.material.positions
    || workingSet.geometry.layerIndices !== workingSet.material.layerIndices
    || workingSet.crackDriver.length !== workingSet.sampleCount
    || workingSet.geometry.coordinates.length !== workingSet.sampleCount * 3
    || workingSet.geometry.positions.length !== workingSet.sampleCount * 3
    || workingSet.geometry.layerIndices.length !== workingSet.sampleCount
    || workingSet.geometry.crackCoverage.length !== workingSet.sampleCount
    || workingSet.geometry.aperture.length !== workingSet.sampleCount
    || workingSet.geometry.displacement.length !== workingSet.sampleCount
    || workingSet.material.albedo.length !== workingSet.sampleCount * 3
    || workingSet.material.roughness.length !== workingSet.sampleCount
    || workingSet.material.wetness.length !== workingSet.sampleCount
    || !Number.isSafeInteger(workingSet.potentialCellCount)
  ) {
    throw new TypeError('road crack working set is required');
  }
}

function requireBudget(sampleBudget) {
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_SAMPLE_BUDGET
  ) {
    throw new RangeError(
      `road repair sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadRepairFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-repair-field:v1' });
  fieldState.set(field, Object.freeze({
    maintenance: conditionChild(root, {
      segment: 'road-field:maintenance',
      channel: 'repair-coverage',
    }),
  }));
  return field;
}

export function realizeRoadRepairCellsReference(
  field,
  roadCracks,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road repair field is required');
  requireRoadCracks(roadCracks);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadCracks.sampleCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadCracks.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadCracks.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadCracks.geometry.layerIndices.subarray(0, sampleCount);
  const repairDriver = new Float32Array(sampleCount);
  const repairAmount = new Float32Array(sampleCount);
  const repairCoverage = new Float32Array(sampleCount);
  const displacement = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);
  const wetness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    repairDriver[sample] = sampleSpatialCorrelation2Reference(
      state.maintenance,
      [coordinates[coordinateOffset], coordinates[coordinateOffset + 1]],
      { correlationLength: 12, mean: 0, amplitude: 1 },
    );
    const cracked = roadCracks.geometry.crackCoverage[sample] > 0;
    const amount = cracked ? clamp01(0.65 + repairDriver[sample] * 0.25) : 0;
    const coverage = roadCracks.geometry.crackCoverage[sample] * amount;
    repairAmount[sample] = amount;
    repairCoverage[sample] = coverage;
    displacement[sample] = roadCracks.geometry.displacement[sample] * (1 - amount)
      + amount * 0.0002;
    roughness[sample] = roadCracks.material.roughness[sample]
      + coverage * (0.83 - roadCracks.material.roughness[sample]);
    wetness[sample] = roadCracks.material.wetness[sample] * (1 - coverage * 0.35);

    const colorOffset = sample * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[colorOffset + channel] = roadCracks.material.albedo[colorOffset + channel]
        + coverage * (
          PATCH_COLOR[channel] - roadCracks.material.albedo[colorOffset + channel]
        );
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    repairCoverage,
    displacement,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    repairCoverage,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-repair-working-set:v1',
    sampleCount,
    potentialCellCount: roadCracks.potentialCellCount,
    repairDriver,
    repairAmount,
    geometry,
    material,
    vectorBytes: repairDriver.byteLength + repairAmount.byteLength
      + repairCoverage.byteLength + displacement.byteLength + albedo.byteLength
      + roughness.byteLength + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadCracks.sampleCount,
  });
}
