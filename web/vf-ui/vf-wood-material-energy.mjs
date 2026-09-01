const MAX_SAMPLES = 65536;
const DIELECTRIC_F0 = 0.04;
const COSINE_PROBES = Object.freeze([1, 0.75, 0.5, 0.25, 0]);
const oracleCache = new WeakMap();

function requireMaterial(material) {
  const sampleCount = Number(material?.imageWidth) * Number(material?.imageHeight);
  if (
    !material
    || material.kind !== 'wood-cut-material-packet:v1'
    || !Number.isSafeInteger(material.imageWidth)
    || material.imageWidth <= 0
    || !Number.isSafeInteger(material.imageHeight)
    || material.imageHeight <= 0
    || !Number.isSafeInteger(sampleCount)
    || sampleCount > MAX_SAMPLES
    || !(material.baseColors instanceof Float32Array)
    || material.baseColors.length !== sampleCount * 4
    || !(material.roughnessR8 instanceof Uint8Array)
    || material.roughnessR8.length !== sampleCount
  ) {
    throw new TypeError('wood cut material packet is required');
  }
  return sampleCount;
}

function requireBudget(sampleBudget, sampleCount) {
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_SAMPLES
  ) {
    throw new RangeError(`wood white-furnace sampleBudget must be an integer from 0 to ${MAX_SAMPLES}`);
  }
  if (sampleCount > sampleBudget) {
    throw new RangeError('wood white-furnace material exceeds sampleBudget');
  }
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function schlickFresnel(cosine) {
  return DIELECTRIC_F0 + (1 - DIELECTRIC_F0) * ((1 - cosine) ** 5);
}

export function evaluateWoodCutWhiteFurnaceReference(
  material,
  { sampleBudget },
) {
  const sampleCount = requireMaterial(material);
  requireBudget(sampleBudget, sampleCount);
  const retained = oracleCache.get(material);
  if (retained) return retained;

  const energyRgb = new Float32Array(sampleCount * COSINE_PROBES.length * 3);
  let minimumEnergy = Infinity;
  let maximumEnergy = -Infinity;
  let violations = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let probe = 0; probe < COSINE_PROBES.length; probe += 1) {
      const fresnel = schlickFresnel(COSINE_PROBES[probe]);
      const diffuseWeight = 1 - fresnel;
      const outputOffset = (sample * COSINE_PROBES.length + probe) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const baseColor = clampUnit(material.baseColors[sample * 4 + channel]);
        const energy = fresnel + diffuseWeight * baseColor;
        energyRgb[outputOffset + channel] = energy;
        minimumEnergy = Math.min(minimumEnergy, energy);
        maximumEnergy = Math.max(maximumEnergy, energy);
        if (energy < -1e-7 || energy > 1 + 1e-7) violations += 1;
      }
    }
  }

  const oracle = Object.freeze({
    kind: 'wood-cut-white-furnace:v1',
    sourceMaterial: material,
    dielectricF0: DIELECTRIC_F0,
    cosineProbes: COSINE_PROBES,
    sampleCount,
    energyRgb,
    minimumEnergy,
    maximumEnergy,
    violations,
    vectorBytes: energyRgb.byteLength,
  });
  oracleCache.set(material, oracle);
  return oracle;
}
