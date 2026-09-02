import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_SAMPLE_BUDGET = 65536;
const BROKEN_EDGE_COLOR = Object.freeze([0.08, 0.065, 0.05]);

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
      `road edge sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadEdgeBreakdownFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-edge-breakdown-field:v1' });
  fieldState.set(field, Object.freeze({
    erosion: conditionChild(root, {
      segment: 'road-field:edge-erosion',
      channel: 'edge-integrity',
    }),
  }));
  return field;
}

export function realizeRoadEdgeBreakdownCellsReference(
  field,
  roadWear,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road edge breakdown field is required');
  requireRoadWear(roadWear);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadWear.sampleCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadWear.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadWear.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadWear.geometry.layerIndices.subarray(0, sampleCount);
  const erosionDriver = new Float32Array(sampleCount);
  const edgeIntegrity = new Float32Array(sampleCount);
  const recession = new Float32Array(sampleCount);
  const displacement = new Float32Array(sampleCount);
  const albedo = new Float32Array(sampleCount * 3);
  const roughness = new Float32Array(sampleCount);
  const wetness = new Float32Array(sampleCount);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const coordinateOffset = sample * 3;
    const longitudinal = coordinates[coordinateOffset];
    const lateral = coordinates[coordinateOffset + 1];
    erosionDriver[sample] = sampleSpatialCorrelation2Reference(
      state.erosion,
      [longitudinal, lateral],
      { correlationLength: 2, mean: 0, amplitude: 1 },
    );
    const traffic = roadWear.drivers[sample * 2];
    const exposure = roadWear.drivers[sample * 2 + 1];
    const wear = clamp01(0.5 + traffic * 0.35 + exposure * 0.15);
    const edgeExposure = clamp01((Math.abs(lateral) - 2.5) / 2);
    const surface = layerIndices[sample] === 0 ? 1 : 0;
    const breakdown = surface * edgeExposure * clamp01(
      0.25
        + erosionDriver[sample] * 0.2
        + wear * 0.25
        + Math.max(0, exposure) * 0.15,
    );
    edgeIntegrity[sample] = 1 - breakdown;
    recession[sample] = breakdown * 0.04;
    displacement[sample] = recession[sample] === 0
      ? 0
      : -recession[sample] * 0.6;
    roughness[sample] = roadWear.material.roughness[sample]
      + breakdown * (0.99 - roadWear.material.roughness[sample]);
    wetness[sample] = clamp01(
      roadWear.material.wetness[sample] + breakdown * 0.15,
    );

    const colorOffset = sample * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[colorOffset + channel] = roadWear.material.albedo[colorOffset + channel]
        + breakdown * (
          BROKEN_EDGE_COLOR[channel] - roadWear.material.albedo[colorOffset + channel]
        );
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    edgeIntegrity,
    recession,
    displacement,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    edgeIntegrity,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-edge-breakdown-working-set:v1',
    sampleCount,
    potentialCellCount: roadWear.potentialCellCount,
    erosionDriver,
    geometry,
    material,
    vectorBytes: erosionDriver.byteLength + edgeIntegrity.byteLength
      + recession.byteLength + displacement.byteLength + albedo.byteLength
      + roughness.byteLength + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadWear.sampleCount,
  });
}
