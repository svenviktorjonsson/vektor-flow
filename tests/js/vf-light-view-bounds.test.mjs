import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectLightViewBounds,
  projectWorldPointToCamera
} from '../../web/vf-ui/geom/vf-light-view-bounds.mjs';

const IDENTITY = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]);

const PERSPECTIVE_90 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -10 / 9, -1,
  0, 0, -10 / 9, 0
]);

const CAMERA = Object.freeze({
  viewMatrix: IDENTITY,
  projectionMatrix: PERSPECTIVE_90,
  nearDepth: 1,
  farDepth: 10
});

test('matches repository column-major WebGPU projection and positive view depth', () => {
  const near = projectWorldPointToCamera([0, 0, -1], CAMERA);
  const far = projectWorldPointToCamera([0, 0, -10], CAMERA);
  const right = projectWorldPointToCamera([5, 0, -5], CAMERA);

  assert.deepEqual(near.viewPosition, [0, 0, -1]);
  assert.equal(near.viewDepth, 1);
  assert.equal(near.clipW, 1);
  assert.ok(Math.abs(near.ndc[2]) < 1e-12);
  assert.equal(far.viewDepth, 10);
  assert.ok(Math.abs(far.ndc[2] - 1) < 1e-12);
  assert.ok(Math.abs(right.ndc[0] - 1) < 1e-12);
});

test('projects a point-light sphere into conservative NDC and positive view depth', () => {
  assert.deepEqual(projectLightViewBounds({
    kind: 'point',
    position: [0, 0, -5],
    radius: 1
  }, CAMERA), {
    minX: -0.25,
    maxX: 0.25,
    minY: -0.25,
    maxY: 0.25,
    minDepth: 4,
    maxDepth: 6
  });
});

test('culls a point sphere wholly outside the camera frustum', () => {
  assert.equal(projectLightViewBounds({
    kind: 'point',
    position: [10, 0, -5],
    radius: 1
  }, CAMERA), null);
});

test('clips a near-plane intersection to finite conservative bounds', () => {
  assert.deepEqual(projectLightViewBounds({
    kind: 'point',
    position: [0, 0, -1],
    radius: 0.5
  }, CAMERA), {
    minX: -0.5,
    maxX: 0.5,
    minY: -0.5,
    maxY: 0.5,
    minDepth: 1,
    maxDepth: 1.5
  });
});

test('keeps a zero-radius light exactly on the NDC boundary', () => {
  assert.deepEqual(projectLightViewBounds({
    kind: 'point',
    position: [5, 0, -5],
    radius: 0
  }, CAMERA), {
    minX: 1,
    maxX: 1,
    minY: 0,
    maxY: 0,
    minDepth: 5,
    maxDepth: 5
  });
});

test('rejects non-finite camera and point-light inputs before projection', () => {
  assert.throws(
    () => projectLightViewBounds({ kind: 'point', position: [0, NaN, -5], radius: 1 }, CAMERA),
    /light.position\[1\] must be finite/
  );
  assert.throws(
    () => projectLightViewBounds({ kind: 'point', position: [0, 0, -5], radius: Infinity }, CAMERA),
    /light.radius must be non-negative and finite/
  );
  assert.throws(
    () => projectLightViewBounds(
      { kind: 'point', position: [0, 0, -5], radius: 1 },
      { ...CAMERA, projectionMatrix: [...PERSPECTIVE_90.slice(0, 15), NaN] }
    ),
    /camera.projectionMatrix\[15\] must be finite/
  );
});
