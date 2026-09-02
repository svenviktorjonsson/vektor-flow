import {
  rotateStokesBasis,
} from "./vf-mueller-reflection-reference.mjs";

export function interpolateComplexIndex(opticalConstants, wavelengthNm) {
  const firstWavelength = opticalConstants.wavelengthsNm[0];
  const lastWavelength = opticalConstants.wavelengthsNm.at(-1);
  if (wavelengthNm < firstWavelength || wavelengthNm > lastWavelength) {
    throw new RangeError(
      "requested wavelength is outside measured optical-constant range",
    );
  }
  const upper = opticalConstants.wavelengthsNm.findIndex(
    (wavelength) => wavelength >= wavelengthNm,
  );
  if (opticalConstants.wavelengthsNm[upper] === wavelengthNm) {
    return {
      real: opticalConstants.n[upper],
      imaginary: opticalConstants.k[upper],
    };
  }
  const lower = upper - 1;
  const width = opticalConstants.wavelengthsNm[upper]
    - opticalConstants.wavelengthsNm[lower];
  const amount = (wavelengthNm - opticalConstants.wavelengthsNm[lower]) / width;
  return {
    real: opticalConstants.n[lower]
      + amount * (opticalConstants.n[upper] - opticalConstants.n[lower]),
    imaginary: opticalConstants.k[lower]
      + amount * (opticalConstants.k[upper] - opticalConstants.k[lower]),
  };
}

function complex(real, imaginary = 0.0) {
  return { real, imaginary };
}

function add(left, right) {
  return complex(
    left.real + right.real,
    left.imaginary + right.imaginary,
  );
}

function subtract(left, right) {
  return complex(
    left.real - right.real,
    left.imaginary - right.imaginary,
  );
}

function multiply(left, right) {
  return complex(
    left.real * right.real - left.imaginary * right.imaginary,
    left.real * right.imaginary + left.imaginary * right.real,
  );
}

function divide(left, right) {
  const denominator = right.real ** 2 + right.imaginary ** 2;
  return complex(
    (left.real * right.real + left.imaginary * right.imaginary) / denominator,
    (left.imaginary * right.real - left.real * right.imaginary) / denominator,
  );
}

function scale(value, amount) {
  return complex(value.real * amount, value.imaginary * amount);
}

function conjugate(value) {
  return complex(value.real, -value.imaginary);
}

function magnitudeSquared(value) {
  return value.real ** 2 + value.imaginary ** 2;
}

function squareRoot(value) {
  const magnitude = Math.hypot(value.real, value.imaginary);
  const real = Math.sqrt(Math.max(0.0, 0.5 * (magnitude + value.real)));
  const imaginaryMagnitude = Math.sqrt(
    Math.max(0.0, 0.5 * (magnitude - value.real)),
  );
  return complex(
    real,
    value.imaginary < 0.0 ? -imaginaryMagnitude : imaginaryMagnitude,
  );
}

export function absorbingReflectionMueller({
  nIncident,
  refractiveIndex,
  cosThetaIncident,
}) {
  const incidentIndex = complex(nIncident);
  const sineSquaredIncident = 1.0 - cosThetaIncident ** 2;
  const indexRatio = divide(incidentIndex, refractiveIndex);
  const sineSquaredTransmitted = scale(
    multiply(indexRatio, indexRatio),
    sineSquaredIncident,
  );
  const cosThetaTransmitted = squareRoot(
    subtract(complex(1.0), sineSquaredTransmitted),
  );
  const incidentCosine = complex(nIncident * cosThetaIncident);
  const transmittedCosine = multiply(refractiveIndex, cosThetaTransmitted);
  const reflectionS = divide(
    subtract(incidentCosine, transmittedCosine),
    add(incidentCosine, transmittedCosine),
  );
  const transmittedIncidentCosine = scale(
    refractiveIndex,
    cosThetaIncident,
  );
  const incidentTransmittedCosine = scale(
    cosThetaTransmitted,
    nIncident,
  );
  const reflectionP = divide(
    subtract(transmittedIncidentCosine, incidentTransmittedCosine),
    add(transmittedIncidentCosine, incidentTransmittedCosine),
  );
  const reflectanceS = magnitudeSquared(reflectionS);
  const reflectanceP = magnitudeSquared(reflectionP);
  const average = 0.5 * (reflectanceS + reflectanceP);
  const difference = 0.5 * (reflectanceS - reflectanceP);
  const phaseCoupling = multiply(reflectionS, conjugate(reflectionP));
  return [
    [average, difference, 0.0, 0.0],
    [difference, average, 0.0, 0.0],
    [0.0, 0.0, phaseCoupling.real, -phaseCoupling.imaginary],
    [0.0, 0.0, phaseCoupling.imaginary, phaseCoupling.real],
  ];
}

function applyMueller(matrix, stokes) {
  return matrix.map((row) => row.reduce(
    (sum, coefficient, index) => sum + coefficient * stokes[index],
    0.0,
  ));
}

export function reflectAbsorbingSpectralStokes({
  wavelengthsNm,
  opticalConstants,
  incidentStokes = [1.0, 0.0, 0.0, 0.0],
  basisRotationRadians = 0.0,
  nIncident,
  cosThetaIncident,
}) {
  const localIncidentStokes = rotateStokesBasis(
    incidentStokes,
    basisRotationRadians,
  );
  const samples = wavelengthsNm.map((wavelengthNm) => {
    const refractiveIndex = interpolateComplexIndex(
      opticalConstants,
      wavelengthNm,
    );
    const mueller = absorbingReflectionMueller({
      nIncident,
      refractiveIndex,
      cosThetaIncident,
    });
    const stokes = applyMueller(mueller, localIncidentStokes);
    return {
      wavelengthNm,
      refractiveIndex,
      mueller,
      stokes,
      absorbedIntensity: localIncidentStokes[0] - stokes[0],
    };
  });
  return { samples };
}
