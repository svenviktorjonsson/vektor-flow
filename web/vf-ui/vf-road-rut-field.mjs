import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_SAMPLE_BUDGET = 65536;

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
    || !(workingSet.geometry?.displacement instanceof Float32Array)
    || !(workingSet.material?.albedo instanceof Float32Array)
    || !(workingSet.material?.roughness instanceof Float32Array)
    || !(workingSet.material?.wetness instanceof Float32Array)
    || workingSet.geometry.coordinates !== workingSet.material.coordinates
    || workingSet.geometry.positions !== workingSet.material.positions
    || workingSet.geometry.layerIndices !== workingSet.material.layerIndices
    || workingSet.geometry.coordinates.length !== workingSet.sampleCount * 3
    || workingSet.geometry.positions.length !== workingSet.sampleCount * 3
    || workingSet.geometry.layerIndices.length !== workingSet.sampleCount
    || workingSet.geometry.displacement.length !== workingSet.sampleCount
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
      `road rut sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadRutFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-rut-field:v1' });
  fieldState.set(field, Object.freeze({
    continuity: conditionChild(root, {
      segment: 'road-field:rut-continuity',
      channel: 'wheel-load',
    }),
  }));
  return field;
}

export function realizeRoadRutCellsReference(
  field,
  roadWear,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road rut field is required');
  requireRoadWear(roadWear);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadWear.sampleCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadWear.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadWear.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadWear.geometry.layerIndices.subarray(0, sampleCount);
  const continuityDriver = new Float32Array(sampleCount);
  const rutIntensity = new Float32Array(sampleCount);
  const rutDepth = new Float32Array(sampleCount);
  const displacement = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);
  const wetness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    const longitudinal = coordinates[coordinateOffset];
    const lateral = coordinates[coordinateOffset + 1];
    continuityDriver[sample] = sampleSpatialCorrelation2Reference(
      state.continuity,
      [longitudinal, lateral],
      { correlationLength: 18, mean: 0, amplitude: 1 },
    );
    const traffic = roadWear.drivers[sample * 2];
    const trafficLoad = clamp01(0.5 + traffic * 0.6);
    const wheelBand = clamp01(
      1 - Math.abs(Math.abs(lateral) - 1.45) / 0.4,
    );
    const surface = layerIndices[sample] === 0 ? 1 : 0;
    const intensity = surface * wheelBand * clamp01(
      0.4 + trafficLoad * 0.45 + continuityDriver[sample] * 0.12,
    );
    const depth = intensity * (0.01 + trafficLoad * 0.02);
    rutIntensity[sample] = intensity;
    rutDepth[sample] = depth;
    displacement[sample] = roadWear.geometry.displacement[sample] - depth;
    roughness[sample] = Math.max(
      0.04,
      roadWear.material.roughness[sample] - intensity * 0.25,
    );
    wetness[sample] = roadWear.material.wetness[sample]
      + intensity * (1 - roadWear.material.wetness[sample]) * 0.18;

    const colorOffset = sample * 3;
    const colorScale = 1 - intensity * 0.12;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[colorOffset + channel] = roadWear.material.albedo[
        colorOffset + channel
      ] * colorScale;
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    rutIntensity,
    rutDepth,
    displacement,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    rutIntensity,
    rutDepth,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-rut-working-set:v1',
    sampleCount,
    potentialCellCount: roadWear.potentialCellCount,
    continuityDriver,
    geometry,
    material,
    vectorBytes: continuityDriver.byteLength + rutIntensity.byteLength
      + rutDepth.byteLength + displacement.byteLength + albedo.byteLength
      + roughness.byteLength + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadWear.sampleCount,
  });
}
