import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';

test('coarse ellipsoid has pinned stable vertices and face identities', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });

  assert.deepEqual(
    shape.vertices.map(({ id, position }) => ({ id, position })),
    [
      { id: 'vertex:+x', position: [3, 0, 0] },
      { id: 'vertex:-x', position: [-3, 0, 0] },
      { id: 'vertex:+y', position: [0, 2, 0] },
      { id: 'vertex:-y', position: [0, -2, 0] },
      { id: 'vertex:+z', position: [0, 0, 1.5] },
      { id: 'vertex:-z', position: [0, 0, -1.5] },
    ],
  );
  assert.deepEqual(shape.faces.map(({ id }) => id), [
    'face:+x:+y:+z',
    'face:-x:+y:+z',
    'face:-x:-y:+z',
    'face:+x:-y:+z',
    'face:+x:+y:-z',
    'face:-x:+y:-z',
    'face:-x:-y:-z',
    'face:+x:-y:-z',
  ]);
  assert.ok(Object.isFrozen(shape));
  assert.ok(Object.isFrozen(shape.vertices));
  assert.ok(Object.isFrozen(shape.faces));
});

test('coarse ellipsoid rejects malformed or degenerate radii', () => {
  assert.throws(() => createCoarseEllipsoidReference({ radii: [1, 2] }), TypeError);
  assert.throws(() => createCoarseEllipsoidReference({ radii: [1, 2, 0] }), RangeError);
  assert.throws(() => createCoarseEllipsoidReference({ radii: [1, -2, 3] }), RangeError);
  assert.throws(() => createCoarseEllipsoidReference({ radii: [1, Infinity, 3] }), RangeError);
  assert.throws(() => createCoarseEllipsoidReference({ radii: [1, '2', 3] }), TypeError);
  assert.deepEqual(
    createCoarseEllipsoidReference({ radii: new Float64Array([3, 2, 1.5]) }).radii,
    [3, 2, 1.5],
  );
});

test('coarse topology is a closed outward-oriented sphere', () => {
  const shape = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const positions = new Map(shape.vertices.map(({ id, position }) => [id, position]));
  const incidence = new Map();
  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

  for (const face of shape.faces) {
    face.boundary.forEach((edge) => incidence.set(edge, (incidence.get(edge) ?? 0) + 1));
    const [a, b, c] = face.vertices.map((vertex) => positions.get(vertex));
    const normal = cross(subtract(b, a), subtract(c, a));
    const centroid = a.map((value, index) => (value + b[index] + c[index]) / 3);
    assert.ok(dot(normal, centroid) > 0, `${face.id} must wind outward`);
  }

  assert.equal(shape.vertices.length, 6);
  assert.equal(incidence.size, 12);
  assert.equal(shape.faces.length, 8);
  assert.ok([...incidence.values()].every((count) => count === 2));
  assert.equal(shape.vertices.length - incidence.size + shape.faces.length, 2);
});
