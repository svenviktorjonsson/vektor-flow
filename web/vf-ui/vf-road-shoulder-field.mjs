import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_SAMPLE_BUDGET = 65536;
const SHOULDER_COLOR = Object.freeze([0.22, 0.2, 0.17]);

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
      `road shoulder sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadShoulderFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-shoulder-field:v1' });
  fieldState.set(field, Object.freeze({
    compaction: conditionChild(root, {
      segment: 'road-field:shoulder-compaction',
      channel: 'shoulder-load',
    }),
  }));
  return field;
}

export function realizeRoadShoulderCellsReference(
  field,
  roadWear,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road shoulder field is required');
  requireRoadWear(roadWear);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadWear.sampleCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadWear.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadWear.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadWear.geometry.layerIndices.subarray(0, sampleCount);
  const compactionDriver = new Float32Array(sampleCount);
  const shoulderState = new Float32Array(sampleCount);
  const displacement = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);
  const wetness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    const longitudinal = coordinates[coordinateOffset];
    const lateral = coordinates[coordinateOffset + 1];
    compactionDriver[sample] = sampleSpatialCorrelation2Reference(
      state.compaction,
      [longitudinal, lateral],
      { correlationLength: 10, mean: 0, amplitude: 1 },
    );
    const traffic = roadWear.drivers[sample * 2];
    const edgeAmount = clamp01((Math.abs(lateral) - 4.25) / 0.5);
    const compaction = clamp01(
      0.55 + traffic * 0.25 + compactionDriver[sample] * 0.15,
    );
    const surface = layerIndices[sample] === 0 ? 1 : 0;
    const cellShoulderState = surface * edgeAmount * compaction;
    shoulderState[sample] = cellShoulderState;
    displacement[sample] = roadWear.geometry.displacement[sample]
      - cellShoulderState * (0.055 - cellShoulderState * 0.02);
    const targetRoughness = 0.96 - cellShoulderState * 0.12;
    roughness[sample] = roadWear.material.roughness[sample]
      + cellShoulderState * (
        targetRoughness - roadWear.material.roughness[sample]
      );
    const targetWetness = roadWear.material.wetness[sample]
      * (0.65 + cellShoulderState * 0.2);
    wetness[sample] = roadWear.material.wetness[sample]
      + cellShoulderState * (targetWetness - roadWear.material.wetness[sample]);

    const colorOffset = sample * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const base = roadWear.material.albedo[colorOffset + channel];
      albedo[colorOffset + channel] = base + cellShoulderState * (
        SHOULDER_COLOR[channel] - base
      );
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    shoulderState,
    displacement,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    shoulderState,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-shoulder-working-set:v1',
    sampleCount,
    potentialCellCount: roadWear.potentialCellCount,
    compactionDriver,
    geometry,
    material,
    vectorBytes: compactionDriver.byteLength + shoulderState.byteLength
      + displacement.byteLength + albedo.byteLength + roughness.byteLength
      + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadWear.sampleCount,
  });
}
