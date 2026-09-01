const MAX_SAMPLES = 65536;
const DIELECTRIC_F0 = 0.04;
const COSINE_PROBES = Object.freeze([1, 0.75, 0.5, 0.25, 0]);
const GGX_ANISOTROPY = 0.65;
const GGX_MIN_ALPHA = 0.08;
const GGX_POLAR_SAMPLES = 96;
const GGX_AZIMUTH_SAMPLES = 192;
const GGX_VIEW_PROBES = Object.freeze([
  Object.freeze({ cosine: 1, azimuth: 0 }),
  Object.freeze({ cosine: 0.5, azimuth: 0 }),
  Object.freeze({ cosine: 0.5, azimuth: Math.PI / 2 }),
  Object.freeze({ cosine: 0.25, azimuth: 0 }),
  Object.freeze({ cosine: 0.25, azimuth: Math.PI / 2 }),
]);
const oracleCache = new WeakMap();
const ggxOracleCache = new WeakMap();

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
    || !(material.normalRgba8 instanceof Uint8ClampedArray)
    || material.normalRgba8.length !== sampleCount * 4
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

function decodedNormal(material, sample) {
  const offset = sample * 4;
  const x = material.normalRgba8[offset] / 127.5 - 1;
  const y = material.normalRgba8[offset + 1] / 127.5 - 1;
  const z = material.normalRgba8[offset + 2] / 127.5 - 1;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function localIncidenceCosine(normal, geometricCosine) {
  const tangentSine = Math.sqrt(Math.max(0, 1 - geometricCosine * geometricCosine));
  return clampUnit(normal[0] * tangentSine + normal[2] * geometricCosine);
}

function localProbeCosine(normal, probe) {
  const tangentSine = Math.sqrt(Math.max(0, 1 - probe.cosine * probe.cosine));
  return clampUnit(
    normal[0] * tangentSine * Math.cos(probe.azimuth)
    + normal[1] * tangentSine * Math.sin(probe.azimuth)
    + normal[2] * probe.cosine,
  );
}

function ggxLambda(x, y, z, alphaX, alphaY) {
  const scaledTangentSquared = (
    alphaX * alphaX * x * x
    + alphaY * alphaY * y * y
  );
  return (Math.sqrt(1 + scaledTangentSquared / (z * z)) - 1) * 0.5;
}

function ggxDistribution(x, y, z, alphaX, alphaY) {
  const scaledLengthSquared = (
    x * x / (alphaX * alphaX)
    + y * y / (alphaY * alphaY)
    + z * z
  );
  return 1 / (Math.PI * alphaX * alphaY * scaledLengthSquared * scaledLengthSquared);
}

function integrateGgxHemisphere(
  viewCosine,
  viewAzimuth,
  alphaX,
  alphaY,
  polarSamples = GGX_POLAR_SAMPLES,
  azimuthSamples = GGX_AZIMUTH_SAMPLES,
) {
  const cosine = Math.max(1e-4, viewCosine);
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const viewX = sine * Math.cos(viewAzimuth);
  const viewY = sine * Math.sin(viewAzimuth);
  const lambdaView = ggxLambda(viewX, viewY, cosine, alphaX, alphaY);
  const sampleWeight = 2 * Math.PI / (polarSamples * azimuthSamples);
  let unitReflectorEnergy = 0;
  let dielectricSpecularEnergy = 0;
  for (let polar = 0; polar < polarSamples; polar += 1) {
    const lightCosine = (polar + 0.5) / polarSamples;
    const lightSine = Math.sqrt(1 - lightCosine * lightCosine);
    for (let azimuth = 0; azimuth < azimuthSamples; azimuth += 1) {
      const lightAzimuth = (azimuth + 0.5) * 2 * Math.PI / azimuthSamples;
      const lightX = lightSine * Math.cos(lightAzimuth);
      const lightY = lightSine * Math.sin(lightAzimuth);
      const halfLength = Math.sqrt(
        (viewX + lightX) ** 2
        + (viewY + lightY) ** 2
        + (cosine + lightCosine) ** 2,
      );
      const halfX = (viewX + lightX) / halfLength;
      const halfY = (viewY + lightY) / halfLength;
      const halfZ = (cosine + lightCosine) / halfLength;
      const viewHalf = Math.max(0, viewX * halfX + viewY * halfY + cosine * halfZ);
      const maskingShadowing = 1 / (
        1 + lambdaView + ggxLambda(lightX, lightY, lightCosine, alphaX, alphaY)
      );
      const brdfWeight = (
        ggxDistribution(halfX, halfY, halfZ, alphaX, alphaY)
        * maskingShadowing
        * sampleWeight
        / (4 * cosine)
      );
      unitReflectorEnergy += brdfWeight;
      dielectricSpecularEnergy += brdfWeight * schlickFresnel(viewHalf);
    }
  }
  return [unitReflectorEnergy, dielectricSpecularEnergy];
}

function realizeGgxProfile(material, sampleCount, kind, anisotropy) {
  const profileSampleCount = sampleCount * GGX_VIEW_PROBES.length;
  const unitReflectorEnergy = new Float32Array(profileSampleCount);
  const dielectricSpecularEnergy = new Float32Array(profileSampleCount);
  const combinedEnergyRgb = new Float32Array(profileSampleCount * 3);
  const alphaX = new Float32Array(sampleCount);
  const alphaY = new Float32Array(sampleCount);
  const aspect = Math.sqrt(1 - 0.9 * anisotropy);
  let minimumEnergy = Infinity;
  let maximumEnergy = -Infinity;
  let maximumQuadratureDelta = 0;
  let violations = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const normal = decodedNormal(material, sample);
    const perceptualRoughness = material.roughnessR8[sample] / 255;
    const alpha = Math.max(GGX_MIN_ALPHA, perceptualRoughness * perceptualRoughness);
    alphaX[sample] = alpha / aspect;
    alphaY[sample] = alpha * aspect;
    for (let probe = 0; probe < GGX_VIEW_PROBES.length; probe += 1) {
      const viewProbe = GGX_VIEW_PROBES[probe];
      const profileOffset = sample * GGX_VIEW_PROBES.length + probe;
      const [unitEnergy, specularEnergy] = integrateGgxHemisphere(
        localProbeCosine(normal, viewProbe),
        viewProbe.azimuth,
        alphaX[sample],
        alphaY[sample],
      );
      const [coarseUnitEnergy, coarseSpecularEnergy] = integrateGgxHemisphere(
        localProbeCosine(normal, viewProbe),
        viewProbe.azimuth,
        alphaX[sample],
        alphaY[sample],
        GGX_POLAR_SAMPLES / 2,
        GGX_AZIMUTH_SAMPLES / 2,
      );
      maximumQuadratureDelta = Math.max(
        maximumQuadratureDelta,
        Math.abs(unitEnergy - coarseUnitEnergy),
        Math.abs(specularEnergy - coarseSpecularEnergy),
      );
      unitReflectorEnergy[profileOffset] = unitEnergy;
      dielectricSpecularEnergy[profileOffset] = specularEnergy;
      const diffuseBudget = 1 - unitEnergy;
      if (
        unitEnergy < -1e-6
        || unitEnergy > 1 + 1e-6
        || specularEnergy < -1e-6
        || specularEnergy > unitEnergy + 1e-6
      ) violations += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const baseColor = clampUnit(material.baseColors[sample * 4 + channel]);
        const combinedEnergy = specularEnergy + diffuseBudget * baseColor;
        combinedEnergyRgb[profileOffset * 3 + channel] = combinedEnergy;
        minimumEnergy = Math.min(minimumEnergy, combinedEnergy);
        maximumEnergy = Math.max(maximumEnergy, combinedEnergy);
        if (combinedEnergy < -1e-6 || combinedEnergy > 1 + 1e-6) violations += 1;
      }
    }
  }
  return Object.freeze({
    kind,
    anisotropy,
    alphaX,
    alphaY,
    unitReflectorEnergy,
    dielectricSpecularEnergy,
    combinedEnergyRgb,
    minimumEnergy,
    maximumEnergy,
    maximumQuadratureDelta,
    violations,
    vectorBytes: alphaX.byteLength
      + alphaY.byteLength
      + unitReflectorEnergy.byteLength
      + dielectricSpecularEnergy.byteLength
      + combinedEnergyRgb.byteLength,
  });
}

export function evaluateWoodCutGgxWhiteFurnaceReference(
  material,
  { sampleBudget },
) {
  const sampleCount = requireMaterial(material);
  requireBudget(sampleBudget, sampleCount);
  const retained = ggxOracleCache.get(material);
  if (retained) return retained;

  const profiles = Object.freeze([
    realizeGgxProfile(material, sampleCount, 'isotropic-ggx', 0),
    realizeGgxProfile(material, sampleCount, 'anisotropic-ggx', GGX_ANISOTROPY),
  ]);
  const oracle = Object.freeze({
    kind: 'wood-cut-ggx-white-furnace:v1',
    sourceMaterial: material,
    dielectricF0: DIELECTRIC_F0,
    viewProbes: GGX_VIEW_PROBES,
    hemisphereSamples: GGX_POLAR_SAMPLES * GGX_AZIMUTH_SAMPLES,
    coarseHemisphereSamples: GGX_POLAR_SAMPLES * GGX_AZIMUTH_SAMPLES / 4,
    sampleCount,
    profiles,
    vectorBytes: profiles.reduce((bytes, profile) => bytes + profile.vectorBytes, 0),
  });
  ggxOracleCache.set(material, oracle);
  return oracle;
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
  let minimumLocalCosine = Infinity;
  let maximumLocalCosine = -Infinity;
  let localCosineSum = 0;
  let violations = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const normal = decodedNormal(material, sample);
    for (let probe = 0; probe < COSINE_PROBES.length; probe += 1) {
      const localCosine = localIncidenceCosine(normal, COSINE_PROBES[probe]);
      minimumLocalCosine = Math.min(minimumLocalCosine, localCosine);
      maximumLocalCosine = Math.max(maximumLocalCosine, localCosine);
      localCosineSum += localCosine;
      const fresnel = schlickFresnel(localCosine);
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
    minimumLocalCosine,
    maximumLocalCosine,
    meanLocalCosine: localCosineSum / (sampleCount * COSINE_PROBES.length),
    violations,
    vectorBytes: energyRgb.byteLength,
  });
  oracleCache.set(material, oracle);
  return oracle;
}
