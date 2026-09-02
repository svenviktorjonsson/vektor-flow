import assert from "node:assert/strict";
import test from "node:test";

import {
  absorbingReflectionMueller,
  interpolateComplexIndex,
  reflectAbsorbingSpectralStokes,
} from "../helpers/vf-absorbing-fresnel-reference.mjs";
import {
  dielectricReflectionMueller,
} from "../helpers/vf-mueller-reflection-reference.mjs";

const tolerance = 1.0e-12;

function assertNear(actual, expected, epsilon = tolerance) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected}, received ${actual}`,
  );
}

const copperLikeOpticalConstants = Object.freeze({
  wavelengthsNm: Object.freeze([400, 500, 700]),
  n: Object.freeze([1.5, 1.7, 2.1]),
  k: Object.freeze([0.1, 0.3, 0.7]),
});

test(
  "complex refractive index interpolates at the requested wavelength",
  () => {
    const index = interpolateComplexIndex(copperLikeOpticalConstants, 600);

    assertNear(index.real, 1.9);
    assertNear(index.imaginary, 0.5);
  },
);

test("optical constants do not extrapolate beyond measured wavelengths", () => {
  for (const wavelengthNm of [350, 800]) {
    assert.throws(
      () => interpolateComplexIndex(
        copperLikeOpticalConstants,
        wavelengthNm,
      ),
      /outside measured optical-constant range/u,
    );
  }
});

test("absorbing-interface Mueller matrix retains complex Fresnel power", () => {
  const mueller = absorbingReflectionMueller({
    nIncident: 1.0,
    refractiveIndex: { real: 0.2, imaginary: 3.0 },
    cosThetaIncident: 1.0,
  });
  const expectedReflectance = ((0.2 - 1.0) ** 2 + 3.0 ** 2)
    / ((0.2 + 1.0) ** 2 + 3.0 ** 2);

  assertNear(mueller[0][0], expectedReflectance);
  assertNear(mueller[0][1], 0.0);
  assertNear(mueller[2][2], -expectedReflectance);
  assertNear(mueller[3][3], -expectedReflectance);
});

test("zero extinction reduces to the real dielectric Mueller matrix", () => {
  const surface = {
    nIncident: 1.0,
    cosThetaIncident: 0.5,
  };
  const absorbing = absorbingReflectionMueller({
    ...surface,
    refractiveIndex: { real: 1.5, imaginary: 0.0 },
  });
  const dielectric = dielectricReflectionMueller({
    ...surface,
    nTransmitted: 1.5,
  });

  for (const [rowIndex, row] of absorbing.entries()) {
    for (const [columnIndex, value] of row.entries()) {
      assertNear(value, dielectric[rowIndex][columnIndex]);
    }
  }
});

test("absorbing spectral reflection phase-couples U and V", () => {
  const reflected = reflectAbsorbingSpectralStokes({
    wavelengthsNm: [500, 600, 700],
    opticalConstants: copperLikeOpticalConstants,
    incidentStokes: [1.0, 0.0, 1.0, 0.0],
    nIncident: 1.0,
    cosThetaIncident: 0.5,
  });
  const middle = reflected.samples[1];

  assertNear(middle.refractiveIndex.real, 1.9);
  assertNear(middle.refractiveIndex.imaginary, 0.5);
  assert.ok(Math.abs(middle.stokes[3]) > 1.0e-4);
  assert.ok(Math.abs(middle.mueller[2][3]) > 1.0e-4);
  assertNear(middle.mueller[2][3], -middle.mueller[3][2]);
});

test("absorbing spectral interfaces preserve passive Stokes energy", () => {
  const incidentStokes = [1.0, 0.3, -0.4, 0.5];
  for (const cosThetaIncident of [0.2, 0.5, 0.8, 1.0]) {
    const reflected = reflectAbsorbingSpectralStokes({
      wavelengthsNm: [400, 500, 600, 700],
      opticalConstants: copperLikeOpticalConstants,
      incidentStokes,
      basisRotationRadians: Math.PI / 9.0,
      nIncident: 1.0,
      cosThetaIncident,
    });
    for (const sample of reflected.samples) {
      const [intensity, q, u, circular] = sample.stokes;
      assert.ok(intensity >= -tolerance);
      assert.ok(intensity <= incidentStokes[0] + tolerance);
      assert.ok(Math.hypot(q, u, circular) <= intensity + tolerance);
      assert.ok(sample.absorbedIntensity >= -tolerance);
      assertNear(intensity + sample.absorbedIntensity, incidentStokes[0]);
    }
  }
});
