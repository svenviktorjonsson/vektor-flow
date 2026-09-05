const MAX_SAMPLE_BUDGET = 65536;
const COSINE_PROBES = Object.freeze([1, 0.75, 0.5, 0.25, 0]);
const AGGREGATE_F0 = dielectricF0(1.56);
const BINDER_F0 = dielectricF0(1.52);
const WATER_F0 = dielectricF0(4 / 3);

function dielectricF0(ior) {
  return ((ior - 1) / (ior + 1)) ** 2;
}

function sameView(left, right) {
  return left.buffer === right.buffer
    && left.byteOffset === right.byteOffset
    && left.byteLength === right.byteLength;
}

function requireAlignedRoadMaterials(construction, water) {
  const constructionMaterial = construction?.material;
  const waterMaterial = water?.material;
  if (
    construction?.kind !== 'road-construction-working-set:v1'
    || water?.kind !== 'road-water-working-set:v1'
    || construction.sampleCount !== water.sampleCount
    || !(constructionMaterial?.coordinates instanceof Float32Array)
    || !(constructionMaterial?.aggregateFraction instanceof Float32Array)
    || !(constructionMaterial?.binderFraction instanceof Float32Array)
    || !(waterMaterial?.coordinates instanceof Float32Array)
    || !(waterMaterial?.waterCoverage instanceof Float32Array)
    || !(waterMaterial?.albedo instanceof Float32Array)
    || !sameView(constructionMaterial.coordinates, waterMaterial.coordinates)
    || constructionMaterial.aggregateFraction.length !== construction.sampleCount
    || constructionMaterial.binderFraction.length !== construction.sampleCount
    || waterMaterial.waterCoverage.length !== water.sampleCount
    || waterMaterial.albedo.length !== water.sampleCount * 3
  ) {
    throw new TypeError('aligned road construction and water working sets are required');
  }
}

function requireBudget(sampleBudget) {
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_SAMPLE_BUDGET
  ) {
    throw new RangeError(
      `road material sampleBudget must be an integer from 0 to ${MAX_SAMPLE_BUDGET}`,
    );
  }
}

export function evaluateRoadMaterialWhiteFurnaceReference(
  construction,
  water,
  { sampleBudget },
) {
  requireAlignedRoadMaterials(construction, water);
  requireBudget(sampleBudget);
  const sampleCount = Math.min(construction.sampleCount, sampleBudget);
  const fresnelF0 = new Float32Array(sampleCount);
  const energyRgb = new Float32Array(
    sampleCount * COSINE_PROBES.length * 3,
  );
  let minimumEnergy = Infinity;
  let maximumEnergy = -Infinity;
  let violations = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const aggregate = construction.material.aggregateFraction[sample];
    const binder = construction.material.binderFraction[sample];
    const dryF0 = aggregate * AGGREGATE_F0 + binder * BINDER_F0;
    const coverage = water.material.waterCoverage[sample];
    const surfaceF0 = dryF0 + coverage * (WATER_F0 - dryF0);
    fresnelF0[sample] = surfaceF0;

    for (let probe = 0; probe < COSINE_PROBES.length; probe += 1) {
      const fresnel = surfaceF0
        + (1 - surfaceF0) * (1 - COSINE_PROBES[probe]) ** 5;
      const outputOffset = (sample * COSINE_PROBES.length + probe) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const albedo = water.material.albedo[sample * 3 + channel];
        const energy = fresnel + (1 - fresnel) * albedo;
        energyRgb[outputOffset + channel] = energy;
        minimumEnergy = Math.min(minimumEnergy, energy);
        maximumEnergy = Math.max(maximumEnergy, energy);
        if (energy < -1e-7 || energy > 1 + 1e-7) violations += 1;
      }
    }
  }

  return Object.freeze({
    kind: 'road-material-white-furnace:v1',
    sourceConstruction: construction,
    sourceWater: water,
    cosineProbes: COSINE_PROBES,
    sampleCount,
    fresnelF0,
    energyRgb,
    minimumEnergy: sampleCount === 0 ? 0 : minimumEnergy,
    maximumEnergy: sampleCount === 0 ? 0 : maximumEnergy,
    violations,
    vectorBytes: fresnelF0.byteLength + energyRgb.byteLength,
    budget: sampleBudget,
    truncated: sampleCount < construction.sampleCount,
  });
}
