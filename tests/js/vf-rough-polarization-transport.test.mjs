import assert from "node:assert/strict";
import test from "node:test";

import {
  averageGgxMueller,
  reflectGgxPolarized,
} from "../helpers/vf-rough-polarization-reference.mjs";
import {
  absorbingReflectionMueller,
  interpolateComplexIndex,
} from "../helpers/vf-absorbing-fresnel-reference.mjs";

const tolerance = 1.0e-12;

function assertMatrixNear(actual, expected) {
  for (const [rowIndex, row] of actual.entries()) {
    for (const [columnIndex, value] of row.entries()) {
      assert.ok(
        Math.abs(value - expected[rowIndex][columnIndex]) <= tolerance,
      );
    }
  }
}

const opticalConstants = Object.freeze({
  wavelengthsNm: Object.freeze([450, 550, 650, 850]),
  n: Object.freeze([1.4, 1.6, 1.9, 2.2]),
  k: Object.freeze([0.05, 0.2, 0.55, 0.9]),
});

const surface = Object.freeze({
  wavelengthNm: 600,
  opticalConstants,
  nIncident: 1.0,
  cosThetaIncident: 0.65,
});

test("GGX Mueller averaging is deterministic for a fixed sample budget", () => {
  const request = {
    ...surface,
    roughness: 0.55,
    sampleCount: 64,
  };
  const first = averageGgxMueller(request);
  const repeated = averageGgxMueller(request);

  assert.deepEqual(repeated, first);
  assert.equal(first.requestedSampleCount, 64);
  assert.ok(first.usedSampleCount > 0);
  assert.ok(first.usedSampleCount <= first.requestedSampleCount);
});

test("GGX averaging enforces a bounded integer sample budget", () => {
  for (const sampleCount of [0, 1.5, 4097]) {
    assert.throws(
      () => averageGgxMueller({
        ...surface,
        roughness: 0.5,
        sampleCount,
      }),
      /sample count must be an integer from 1 through 4096/u,
    );
  }
});

test("zero roughness equals wavelength-specific absorbing Fresnel", () => {
  const refractiveIndex = interpolateComplexIndex(opticalConstants, 600);
  const smooth = averageGgxMueller({
    ...surface,
    roughness: 0.0,
    sampleCount: 64,
  });
  const expected = absorbingReflectionMueller({
    nIncident: surface.nIncident,
    refractiveIndex,
    cosThetaIncident: surface.cosThetaIncident,
  });

  assertMatrixNear(smooth.mueller, expected);
  assert.deepEqual(smooth.refractiveIndex, refractiveIndex);
  assert.equal(smooth.usedSampleCount, 1);
});

test("rough GGX orientation averaging depolarizes reflected light", () => {
  const incidentStokes = [1.0, 1.0, 0.0, 0.0];
  const smooth = reflectGgxPolarized({
    ...surface,
    incidentStokes,
    roughness: 0.0,
    sampleCount: 128,
  });
  const rough = reflectGgxPolarized({
    ...surface,
    incidentStokes,
    roughness: 0.7,
    sampleCount: 128,
  });

  assert.ok(smooth.degreeOfPolarization > 1.0 - tolerance);
  assert.ok(rough.degreeOfPolarization < smooth.degreeOfPolarization - 0.01);
  assert.ok(rough.degreeOfPolarization >= 0.0);
});

test("rough spectral Mueller averages remain passive", () => {
  const physicalStates = [
    [1.0, 0.0, 0.0, 0.0],
    [1.0, 1.0, 0.0, 0.0],
    [1.0, 0.0, 0.6, 0.8],
    [1.0, 0.3, -0.4, 0.5],
  ];
  for (const wavelengthNm of [450, 600, 850]) {
    for (const roughness of [0.1, 0.5, 0.9]) {
      for (const incidentStokes of physicalStates) {
        const result = reflectGgxPolarized({
          ...surface,
          wavelengthNm,
          incidentStokes,
          roughness,
          sampleCount: 128,
        });
        assert.ok(result.stokes[0] >= -tolerance);
        assert.ok(result.stokes[0] <= incidentStokes[0] + tolerance);
        assert.ok(result.degreeOfPolarization <= 1.0 + tolerance);
        assert.ok(result.absorbedIntensity >= -tolerance);
        assert.ok(
          Math.abs(
            result.stokes[0]
            + result.absorbedIntensity
            - incidentStokes[0],
          ) <= tolerance,
        );
      }
    }
  }
});
