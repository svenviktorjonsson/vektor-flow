import {
  absorbingReflectionMueller,
  interpolateComplexIndex,
} from "./vf-absorbing-fresnel-reference.mjs";

const goldenRatioConjugate = 0.6180339887498949;

function zeroMatrix() {
  return Array.from({ length: 4 }, () => [0.0, 0.0, 0.0, 0.0]);
}

function multiplyMatrices(left, right) {
  return left.map((row) => right[0].map((_, column) => row.reduce(
    (sum, coefficient, index) =>
      sum + coefficient * right[index][column],
    0.0,
  )));
}

function stokesRotation(angleRadians) {
  const cosine = Math.cos(2.0 * angleRadians);
  const sine = Math.sin(2.0 * angleRadians);
  return [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, cosine, sine, 0.0],
    [0.0, -sine, cosine, 0.0],
    [0.0, 0.0, 0.0, 1.0],
  ];
}

function dot(left, right) {
  return left.reduce(
    (sum, value, index) => sum + value * right[index],
    0.0,
  );
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(value, fallback) {
  const length = Math.hypot(...value);
  return length > 1.0e-12
    ? value.map((component) => component / length)
    : fallback;
}

function basisRotation(incident, macroS, microfacetNormal) {
  const microS = normalize(cross(incident, microfacetNormal), macroS);
  const cosine = Math.max(-1.0, Math.min(1.0, dot(macroS, microS)));
  const sine = dot(cross(macroS, microS), incident);
  return Math.atan2(sine, cosine);
}

function addMatrix(target, source) {
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      target[row][column] += source[row][column];
    }
  }
}

export function averageGgxMueller({
  wavelengthNm,
  opticalConstants,
  nIncident,
  cosThetaIncident,
  roughness,
  sampleCount,
}) {
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 4096) {
    throw new RangeError(
      "GGX sample count must be an integer from 1 through 4096",
    );
  }
  const refractiveIndex = interpolateComplexIndex(
    opticalConstants,
    wavelengthNm,
  );
  if (roughness === 0.0) {
    return {
      mueller: absorbingReflectionMueller({
        nIncident,
        refractiveIndex,
        cosThetaIncident,
      }),
      refractiveIndex,
      requestedSampleCount: sampleCount,
      usedSampleCount: 1,
    };
  }

  const sineThetaIncident = Math.sqrt(1.0 - cosThetaIncident ** 2);
  const incident = [sineThetaIncident, 0.0, cosThetaIncident];
  const macroS = sineThetaIncident > 1.0e-12
    ? normalize(cross(incident, [0.0, 0.0, 1.0]), [0.0, -1.0, 0.0])
    : [0.0, -1.0, 0.0];
  const alpha = roughness ** 2;
  const accumulated = zeroMatrix();
  let usedSampleCount = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const radialSample = (index + 0.5) / sampleCount;
    const azimuthSample = ((index + 0.5) * goldenRatioConjugate) % 1.0;
    const tangentSquared = alpha ** 2
      * radialSample / (1.0 - radialSample);
    const cosThetaMicrofacet = 1.0 / Math.sqrt(1.0 + tangentSquared);
    const sinThetaMicrofacet = Math.sqrt(1.0 - cosThetaMicrofacet ** 2);
    const azimuth = 2.0 * Math.PI * azimuthSample;
    const microfacetNormal = [
      sinThetaMicrofacet * Math.cos(azimuth),
      sinThetaMicrofacet * Math.sin(azimuth),
      cosThetaMicrofacet,
    ];
    const localCosine = dot(incident, microfacetNormal);
    if (localCosine <= 0.0) continue;

    const rotation = basisRotation(incident, macroS, microfacetNormal);
    const localMueller = absorbingReflectionMueller({
      nIncident,
      refractiveIndex,
      cosThetaIncident: localCosine,
    });
    const commonBasisMueller = multiplyMatrices(
      stokesRotation(-rotation),
      multiplyMatrices(localMueller, stokesRotation(rotation)),
    );
    addMatrix(accumulated, commonBasisMueller);
    usedSampleCount += 1;
  }

  const mueller = accumulated.map((row) => row.map((value) =>
    value / usedSampleCount));
  return {
    mueller,
    refractiveIndex,
    requestedSampleCount: sampleCount,
    usedSampleCount,
  };
}

function applyMueller(matrix, stokes) {
  return matrix.map((row) => row.reduce(
    (sum, coefficient, index) => sum + coefficient * stokes[index],
    0.0,
  ));
}

export function reflectGgxPolarized({ incidentStokes, ...request }) {
  const average = averageGgxMueller(request);
  const stokes = applyMueller(average.mueller, incidentStokes);
  const polarizedMagnitude = Math.hypot(stokes[1], stokes[2], stokes[3]);
  return {
    ...average,
    stokes,
    degreeOfPolarization: stokes[0] > 0.0
      ? polarizedMagnitude / stokes[0]
      : 0.0,
    absorbedIntensity: incidentStokes[0] - stokes[0],
  };
}
