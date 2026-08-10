import test from 'node:test';
import assert from 'node:assert/strict';

import {
  axis2dCrosshairLabelNormal,
  axis2dCrosshairTickNormal,
  solveAxis2dBoundaryLabel,
  solveAxis2dSideLabel
} from '../../web/vf-ui/vf-axis2d-label-layout.mjs';

test('crosshair axis names stay opposite the VKF tick-label side', () => {
  const axes = {
    x: [Math.SQRT1_2, Math.SQRT1_2],
    y: [Math.SQRT1_2, -Math.SQRT1_2]
  };
  assertVectorNear(axis2dCrosshairLabelNormal('x', axes), axes.y);
  assertVectorNear(axis2dCrosshairLabelNormal('y', axes), [-axes.x[0], -axes.x[1]]);
});

test('rotated tick labels follow their axis side', () => {
  const axes = {
    x: [Math.SQRT1_2, Math.SQRT1_2],
    y: [Math.SQRT1_2, -Math.SQRT1_2]
  };
  const normal = axis2dCrosshairTickNormal('x', axes);
  const solved = solveAxis2dSideLabel({
    axisPoint: [160, 100],
    preferredNormal: normal,
    labelSize: [20, 14],
    bounds: [320, 200],
    axisGap: 5
  });
  assert.ok(dot(subtract(solved.center, [160, 100]), normal) > 0);
  assert.ok(dot(normal, axis2dCrosshairLabelNormal('x', axes)) < -0.999);
});

test('rotated boundary labels preserve axis side and fixed frame margin', () => {
  const normal = [Math.SQRT1_2, -Math.SQRT1_2];
  const solved = solveAxis2dBoundaryLabel({
    axisOrigin: [160, 100],
    axisDirection: [Math.SQRT1_2, Math.SQRT1_2],
    preferredNormal: normal,
    labelSize: [14, 16],
    bounds: [320, 200],
    boundaryInset: 20,
    axisGap: 8
  });

  assert.equal(solved.boundarySide, 'bottom');
  assert.ok(dot(subtract(solved.center, solved.boundaryPoint), normal) > 0);
  assert.equal(solved.top + 16, 180);
});

function subtract(left, right) {
  return [left[0] - right[0], left[1] - right[1]];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1];
}

function assertVectorNear(actual, expected) {
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-12);
}
