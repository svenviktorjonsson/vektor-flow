import assert from "node:assert/strict";
import test from "node:test";

import {
  reflectDielectricStokes,
  rotateStokesBasis,
  transportStokesReflections,
} from "../helpers/vf-mueller-reflection-reference.mjs";

const tolerance = 1.0e-12;

function assertVectorNear(actual, expected, epsilon = tolerance) {
  assert.equal(actual.length, expected.length);
  for (const [index, value] of actual.entries()) {
    assert.ok(
      Math.abs(value - expected[index]) <= epsilon,
      `component ${index}: expected ${expected[index]}, received ${value}`,
    );
  }
}

test("Stokes basis rotation uses the polarization double angle", () => {
  const horizontal = [1.0, 1.0, 0.0, 0.0];
  const diagonalBasis = rotateStokesBasis(horizontal, Math.PI / 4.0);
  const restored = rotateStokesBasis(diagonalBasis, -Math.PI / 4.0);

  assertVectorNear(diagonalBasis, [1.0, 0.0, -1.0, 0.0]);
  assertVectorNear(restored, horizontal);
});

test("dielectric reflection defaults to unpolarized incident light", () => {
  const reflected = reflectDielectricStokes({
    nIncident: 1.0,
    nTransmitted: 1.5,
    cosThetaIncident: 1.0,
  });

  assertVectorNear(reflected.stokes, [0.04, 0.0, 0.0, 0.0]);
  assertVectorNear(reflected.incidentStokes, [1.0, 0.0, 0.0, 0.0]);
});

test("Brewster incidence extinguishes p but retains s reflection", () => {
  const brewsterAngle = Math.atan(1.5 / 1.0);
  const surface = {
    nIncident: 1.0,
    nTransmitted: 1.5,
    cosThetaIncident: Math.cos(brewsterAngle),
  };
  const pPolarized = reflectDielectricStokes({
    ...surface,
    incidentStokes: [1.0, -1.0, 0.0, 0.0],
  });
  const sPolarized = reflectDielectricStokes({
    ...surface,
    incidentStokes: [1.0, 1.0, 0.0, 0.0],
  });

  assert.ok(pPolarized.stokes[0] < 1.0e-28);
  assert.ok(sPolarized.stokes[0] > 0.1);
  assert.ok(sPolarized.stokes[0] <= 1.0);
});

test("passive dielectric reflection preserves Stokes energy bounds", () => {
  const physicalStates = [
    [1.0, 0.0, 0.0, 0.0],
    [1.0, 1.0, 0.0, 0.0],
    [1.0, -1.0, 0.0, 0.0],
    [1.0, 0.0, 1.0, 0.0],
    [1.0, 0.0, 0.0, 1.0],
    [1.0, 0.3, -0.4, 0.5],
  ];
  for (const incidentStokes of physicalStates) {
    for (const cosThetaIncident of [0.2, 0.5, 0.8, 1.0]) {
      const { stokes } = reflectDielectricStokes({
        incidentStokes,
        basisRotationRadians: Math.PI / 7.0,
        nIncident: 1.0,
        nTransmitted: 1.5,
        cosThetaIncident,
      });
      const polarizedMagnitude = Math.hypot(stokes[1], stokes[2], stokes[3]);
      assert.ok(stokes[0] >= -tolerance);
      assert.ok(stokes[0] <= incidentStokes[0] + tolerance);
      assert.ok(polarizedMagnitude <= stokes[0] + tolerance);
    }
  }
});

test("each mirror reflection reverses circular handedness", () => {
  const bounce = {
    basisRotationRadians: 0.0,
    nIncident: 1.0,
    nTransmitted: 1.5,
    cosThetaIncident: 1.0,
  };
  const incidentStokes = [1.0, 0.0, 0.0, 1.0];
  const once = transportStokesReflections({
    incidentStokes,
    reflections: [bounce],
  });
  const twice = transportStokesReflections({
    incidentStokes,
    reflections: [bounce, bounce],
  });

  assertVectorNear(once.stokes, [0.04, 0.0, 0.0, -0.04]);
  assertVectorNear(twice.stokes, [0.0016, 0.0, 0.0, 0.0016]);
  assert.equal(twice.history.length, 2);
});
