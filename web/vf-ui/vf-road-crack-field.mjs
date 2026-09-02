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
      `road crack sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function createRoadCrackFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({ kind: 'road-crack-field:v1' });
  fieldState.set(field, Object.freeze({
    fracture: conditionChild(root, {
      segment: 'road-field:fracture',
      channel: 'crack-propensity',
    }),
  }));
  return field;
}

export function realizeRoadCrackCellsReference(
  field,
  roadWear,
  { sampleBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('road crack field is required');
  requireRoadWear(roadWear);
  requireBudget(sampleBudget);

  const sampleCount = Math.min(roadWear.sampleCount, sampleBudget);
  const coordinateCount = sampleCount * 3;
  const coordinates = roadWear.geometry.coordinates.subarray(0, coordinateCount);
  const positions = roadWear.geometry.positions.subarray(0, coordinateCount);
  const layerIndices = roadWear.geometry.layerIndices.subarray(0, sampleCount);
  const crackDriver = new Float32Array(sampleCount);
  const crackCoverage = new Float32Array(sampleCount);
  const aperture = new Float32Array(sampleCount);
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
    crackDriver[sample] = sampleSpatialCorrelation2Reference(
      state.fracture,
      fieldPosition,
      { correlationLength: 6, mean: 0, amplitude: 1 },
    );
    const traffic = roadWear.drivers[sample * 2];
    const exposure = roadWear.drivers[sample * 2 + 1];
    const propensity = clamp01(
      0.52
        + crackDriver[sample] * 0.36
        + Math.max(0, traffic) * 0.28
        + Math.max(0, exposure) * 0.12,
    );
    const surface = layerIndices[sample] === 0 ? 1 : 0;
    const coverage = surface * clamp01((propensity - 0.38) * 1.65);
    crackCoverage[sample] = coverage;
    aperture[sample] = coverage * (0.004 + Math.max(0, traffic) * 0.002);
    displacement[sample] = aperture[sample] === 0
      ? 0
      : -aperture[sample] * 0.75;
    roughness[sample] = clamp01(
      roadWear.material.roughness[sample]
        + coverage * (0.16 - roadWear.material.wetness[sample] * 0.08),
    );
    wetness[sample] = clamp01(
      roadWear.material.wetness[sample] + coverage * 0.22,
    );

    const colorOffset = sample * 3;
    const darkening = 1 - coverage * 0.68;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[colorOffset + channel] =
        roadWear.material.albedo[colorOffset + channel] * darkening;
    }
  }

  const geometry = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    crackCoverage,
    aperture,
    displacement,
  });
  const material = Object.freeze({
    coordinates,
    positions,
    layerIndices,
    crackCoverage,
    albedo,
    roughness,
    wetness,
  });
  return Object.freeze({
    kind: 'road-crack-working-set:v1',
    sampleCount,
    potentialCellCount: roadWear.potentialCellCount,
    crackDriver,
    geometry,
    material,
    vectorBytes: crackDriver.byteLength + crackCoverage.byteLength
      + aperture.byteLength + displacement.byteLength + albedo.byteLength
      + roughness.byteLength + wetness.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < roadWear.sampleCount,
  });
}
