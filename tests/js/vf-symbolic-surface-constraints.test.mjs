import test from 'node:test';
import assert from 'node:assert/strict';

import { clipSymbolicGeometry3dByConstraints } from '../../web/vf-ui/vf-symbolic-surface-constraints.mjs';

const plane = Object.freeze({
  points: [[-1, 0, 0], [1, 0, 0]],
  paths: [[[-1, 0, 0], [1, 0, 0]]],
  triangles: [
    [[-1, -1, 0], [1, -1, 0], [1, 1, 0]],
    [[-1, -1, 0], [1, 1, 0], [-1, 1, 0]]
  ]
});

test('clips sampled 3D surfaces and emits inclusive boundary edges', () => {
  const clipped = clipSymbolicGeometry3dByConstraints(plane, [{
    id: 'x-limit', inclusive: true, residual: ([x]) => x
  }]);

  assert.ok(clipped.triangles.length > 0);
  assert.ok(clipped.triangles.flat(2).every((value, index) => index % 3 !== 0 || value <= 1e-9));
  assert.ok(clipped.paths.every((path) => path.every(([x]) => x <= 1e-9)));
  assert.equal(clipped.points.length, 1);
  assert.ok(clipped.boundaryEdges.length >= 1);
  assert.ok(clipped.boundaryEdges.every(({ constraintId, path }) => (
    constraintId === 'x-limit' && path.every(([x]) => Math.abs(x) <= 1e-9)
  )));
});

test('strict 3D constraints clip geometry without emitting boundary edges', () => {
  const clipped = clipSymbolicGeometry3dByConstraints(plane, [{
    id: 'x-limit', inclusive: false, residual: ([x]) => x
  }]);
  assert.ok(clipped.triangles.length > 0);
  assert.deepEqual(clipped.boundaryEdges, []);
});

test('clips inclusive boundary edges by every other active constraint', () => {
  const clipped = clipSymbolicGeometry3dByConstraints(plane, [
    { id: 'x-limit', inclusive: true, residual: ([x]) => x },
    { id: 'y-limit', inclusive: false, residual: ([, y]) => y }
  ]);
  assert.ok(clipped.boundaryEdges.length >= 1);
  assert.ok(clipped.boundaryEdges.every(({ path }) => path.every(([, y]) => y <= 1e-9)));
});
