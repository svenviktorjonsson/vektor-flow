import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_SAMPLE_BUDGET = 65536;
const LAYER_PROFILES = Object.freeze([
  Object.freeze({
    aggregate: 0.58,
    binder: 0.34,
    aggregateColor: Object.freeze([0.26, 0.25, 0.24]),
    binderColor: Object.freeze([0.045, 0.043, 0.04]),
    roughness: 0.78,
    relief: 0.006,
  }),
  Object.freeze({
    aggregate: 0.72,
    binder: 0.18,
    aggregateColor: Object.freeze([0.23, 0.21, 0.19]),
    binderColor: Object.freeze([0.06, 0.055, 0.05]),
    roughness: 0.88,
    relief: 0.002,
  }),
  Object.freeze({
    aggregate: 0.82,
    binder: 0.08,
    aggregateColor: Object.freeze([0.31, 0.28, 0.24]),
    binderColor: Object.freeze([0.08, 0.073, 0.065]),
    roughness: 0.94,
    relief: 0.001,
  }),
]);

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
      `road construction sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadConstructionFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-construction-field:v1' });
  fieldState.set(field, Object.freeze({
    aggregate: conditionChild(root, {
      segment: 'road-construction:aggregate',
      channel: 'aggregate-mixture',
    }),
    binder: conditionChild(root, {
      segment: 'road-construction:binder',
      channel: 'binder-mixture',
    }),
  }));
  return field;
}

export function realizeRoadConstructionCellsReference(
  field,
  roadCoordinates,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road construction field is required');
  requireRoadCoordinates(roadCoordinates);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadCoordinates.cellCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadCoordinates.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadCoordinates.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadCoordinates.geometry.layerIndices.subarray(0, sampleCount);
  const drivers = new Float32Array(sampleCount * 2);
  const displacement = new Float32Array(sampleCount);
  const aggregateFraction = new Float32Array(sampleCount);
  const binderFraction = new Float32Array(sampleCount);
  const voidFraction = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    const fieldPosition = [
      coordinates[coordinateOffset],
      coordinates[coordinateOffset + 1],
    ];
    const driverOffset = sample * 2;
    const aggregateDriver = sampleSpatialCorrelation2Reference(
      state.aggregate,
      fieldPosition,
      { correlationLength: 0.45, mean: 0, amplitude: 1 },
    );
    const binderDriver = sampleSpatialCorrelation2Reference(
      state.binder,
      fieldPosition,
      { correlationLength: 1.2, mean: 0, amplitude: 1 },
    );
    drivers[driverOffset] = aggregateDriver;
    drivers[driverOffset + 1] = binderDriver;

    const layer = Math.min(layerIndices[sample], LAYER_PROFILES.length - 1);
    const profile = LAYER_PROFILES[layer];
    const aggregate = profile.aggregate + aggregateDriver * 0.025;
    const binder = profile.binder + binderDriver * 0.015;
    const voids = 1 - aggregate - binder;
    aggregateFraction[sample] = aggregate;
    binderFraction[sample] = binder;
    voidFraction[sample] = voids;
    displacement[sample] = aggregateDriver * profile.relief;
    roughness[sample] = clamp01(
      profile.roughness + aggregateDriver * 0.04 - binderDriver * 0.03,
    );

    const colorOffset = sample * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[colorOffset + channel] =
        aggregate * profile.aggregateColor[channel]
        + binder * profile.binderColor[channel]
        + voids * 0.015;
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    displacement,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    aggregateFraction,
    binderFraction,
    voidFraction,
    albedo,
    roughness,
  });
  return Object.freeze({
    kind: 'road-construction-working-set:v1',
    sampleCount,
    potentialCellCount: roadCoordinates.potentialCellCount,
    drivers,
    geometry,
    material,
    vectorBytes: drivers.byteLength + displacement.byteLength
      + aggregateFraction.byteLength + binderFraction.byteLength
      + voidFraction.byteLength + albedo.byteLength + roughness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadCoordinates.cellCount,
  });
}
