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

test('rejects an OpenGL minus-one-to-one depth projection', () => {
  const openGlPerspective = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -11 / 9, -1,
    0, 0, -20 / 9, 0
  ];
  assert.throws(
    () => projectWorldPointToCamera([0, 0, -5], {
      ...CAMERA,
      projectionMatrix: openGlPerspective
    }),
    /camera.projectionMatrix must use WebGPU z in \[0, 1\]/
  );
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

test('projects a spot cone through a conservative finite sphere envelope', () => {
  const result = projectLightViewBounds({
    kind: 'spot',
    position: [0, 0, -4],
    direction: [0, 0, -1],
    range: 2,
    outerConeCos: Math.SQRT1_2
  }, CAMERA);

  assert.ok(result.minX <= -0.8 && result.maxX >= 0.8);
  assert.ok(result.minY <= -0.8 && result.maxY >= 0.8);
  assert.ok(result.minDepth < 3 && result.maxDepth > 7);
  assert.equal(Object.values(result).every(Number.isFinite), true);
  assert.equal(projectLightViewBounds({
    kind: 'spot',
    position: [20, 0, -4],
    direction: [0, 0, -1],
    range: 2,
    outerConeCos: Math.SQRT1_2
  }, CAMERA), null);
});

test('projects finite geometry-light points and culls off-frustum geometry', () => {
  const square = [
    [-1, -1, -5], [1, -1, -5], [1, 1, -5], [-1, 1, -5]
  ];
  const projected = projectLightViewBounds({ kind: 'projected', points: square }, CAMERA);
  const geometry = projectLightViewBounds({ kind: 'geometry', points: square }, CAMERA);

  assert.deepEqual(geometry, projected);
  assert.ok(projected.minX <= -0.2 && projected.maxX >= 0.2);
  assert.ok(projected.minY <= -0.2 && projected.maxY >= 0.2);
  assert.ok(projected.minDepth > 3 && projected.maxDepth < 7);
  assert.equal(projectLightViewBounds({
    kind: 'geometry',
    points: square.map(([x, y, z]) => [x + 20, y, z])
  }, CAMERA), null);
});

test('keeps projected geometry intersecting the near plane finite', () => {
  const result = projectLightViewBounds({
    kind: 'projected',
    points: [[-0.2, 0, -0.5], [0.2, 0, -2]]
  }, CAMERA);

  assert.ok(result);
  assert.equal(Object.values(result).every(Number.isFinite), true);
  assert.equal(result.minDepth, 1);
  assert.ok(result.maxDepth >= 2);
});

test('rejects invalid spot and geometry envelopes before projection', () => {
  assert.throws(
    () => projectLightViewBounds({
      kind: 'spot', position: [0, 0, -5], direction: [0, 0, 0], range: 2, outerConeCos: 0.8
    }, CAMERA),
    /light.direction must be non-zero/
  );
  assert.throws(
    () => projectLightViewBounds({
      kind: 'spot', position: [0, 0, -5], direction: [0, 0, -1], range: 2, outerConeCos: 0
    }, CAMERA),
    /light.outerConeCos must be greater than zero and at most one/
  );
  assert.throws(
    () => projectLightViewBounds({ kind: 'geometry', points: [] }, CAMERA),
    /light.points must not be empty/
  );
});
