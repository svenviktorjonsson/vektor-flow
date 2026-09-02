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

function requireRoadCoordinates(workingSet) {
  if (
    !workingSet
    || workingSet.kind !== 'road-coordinate-working-set:v1'
    || workingSet.geometry !== workingSet.material
    || !(workingSet.geometry?.coordinates instanceof Float32Array)
    || !(workingSet.geometry?.positions instanceof Float32Array)
    || !(workingSet.geometry?.layerIndices instanceof Uint16Array)
    || workingSet.geometry.coordinates.length !== workingSet.cellCount * 3
    || workingSet.geometry.positions.length !== workingSet.cellCount * 3
    || workingSet.geometry.layerIndices.length !== workingSet.cellCount
    || !Number.isSafeInteger(workingSet.potentialCellCount)
  ) {
    throw new TypeError('road coordinate working set is required');
  }
}

function requireBudget(sampleBudget) {
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_SAMPLE_BUDGET
  ) {
    throw new RangeError(
      `road wear sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadWearFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-wear-field:v1' });
  fieldState.set(field, Object.freeze({
    traffic: conditionChild(root, {
      segment: 'road-field:traffic',
      channel: 'traffic-load',
    }),
    exposure: conditionChild(root, {
      segment: 'road-field:exposure',
      channel: 'weather-exposure',
    }),
  }));
  return field;
}

export function realizeRoadWearCellsReference(
  field,
  roadCoordinates,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road wear field is required');
  requireRoadCoordinates(roadCoordinates);
  requireBudget(sampleBudget);
  const sampleCount = Math.min(roadCoordinates.cellCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadCoordinates.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadCoordinates.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadCoordinates.geometry.layerIndices.subarray(0, sampleCount);
  const drivers = new Float32Array(sampleCount * 2);
  const displacement = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);
  const wetness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    const fieldPosition = [
      coordinates[coordinateOffset],
      coordinates[coordinateOffset + 1],
    ];
    const driverOffset = sample * 2;
    drivers[driverOffset] = sampleSpatialCorrelation2Reference(
      state.traffic,
      fieldPosition,
      { correlationLength: 24, mean: 0, amplitude: 0.65 },
    );
    drivers[driverOffset + 1] = sampleSpatialCorrelation2Reference(
      state.exposure,
      fieldPosition,
      { correlationLength: 80, mean: 0, amplitude: 0.75 },
    );
    const traffic = drivers[driverOffset];
    const exposure = drivers[driverOffset + 1];
    const wear = clamp01(0.5 + traffic * 0.35 + exposure * 0.15);
    const cellWetness = clamp01(0.45 - exposure * 0.3 + wear * 0.1);
    const colorScale = (1 - wear * 0.18) * (1 - cellWetness * 0.25);
    const colorOffset = sample * 3;

    displacement[sample] = -0.025 * wear;
    wetness[sample] = cellWetness;
    roughness[sample] = 0.95 - wear * 0.45 - cellWetness * 0.2;
    albedo[colorOffset] = 0.12 * colorScale;
    albedo[colorOffset + 1] = 0.115 * colorScale;
    albedo[colorOffset + 2] = 0.11 * colorScale;
  }

  const geometry = Object.freeze({ coordinates, positions, layerIndices, displacement });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-wear-working-set:v1',
    sampleCount,
    potentialCellCount: roadCoordinates.potentialCellCount,
    drivers,
    geometry,
    material,
    vectorBytes: drivers.byteLength + displacement.byteLength + albedo.byteLength
      + roughness.byteLength + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadCoordinates.cellCount,
  });
}
