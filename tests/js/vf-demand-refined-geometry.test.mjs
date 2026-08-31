import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
  refineEllipsoidFaceReference,
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

test('one demanded face receives pinned stable refinement identities', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const refined = refineEllipsoidFaceReference(coarse, 'face:+x:+y:+z');
  const center = refined.vertices.find(({ id }) => (
    id === 'vertex:face:+x:+y:+z/refine:1/center'
  ));

  assert.deepEqual(center, {
    id: 'vertex:face:+x:+y:+z/refine:1/center',
    position: [1.7320508075688774, 1.1547005383792517, 0.8660254037844387],
  });
  assert.deepEqual(
    refined.faces.filter(({ id }) => id.includes('/refine:1/')).map(({ id }) => id),
    [
      'face:+x:+y:+z/refine:1/child:0',
      'face:+x:+y:+z/refine:1/child:1',
      'face:+x:+y:+z/refine:1/child:2',
    ],
  );
  assert.equal(refined.vertices.length, 7);
  assert.equal(refined.faces.length, 10);
});

test('face refinement rejects foreign shapes and unavailable faces', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const refined = refineEllipsoidFaceReference(coarse, 'face:+x:+y:+z');

  assert.throws(
    () => refineEllipsoidFaceReference({}, 'face:+x:+y:+z'),
    TypeError,
  );
  assert.throws(
    () => refineEllipsoidFaceReference(coarse, 'face:missing'),
    RangeError,
  );
  assert.throws(
    () => refineEllipsoidFaceReference(refined, 'face:+x:+y:+z/refine:1/child:0'),
    RangeError,
  );
});

test('one-face refinement stays closed, conforming, and on the ellipsoid', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const refined = refineEllipsoidFaceReference(coarse, 'face:+x:+y:+z');
  const positions = new Map(refined.vertices.map(({ id, position }) => [id, position]));
  const incidence = new Map();
  let signedVolume = 0;

  for (const face of refined.faces) {
    face.boundary.forEach((edge) => incidence.set(edge, (incidence.get(edge) ?? 0) + 1));
    const [a, b, c] = face.vertices.map((vertex) => positions.get(vertex));
    signedVolume += (
      a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }

  const parent = coarse.faces.find(({ id }) => id === 'face:+x:+y:+z');
  const center = positions.get(refined.refinement.center);
  const ellipsoidResidual = (center[0] / 3) ** 2
    + (center[1] / 2) ** 2
    + (center[2] / 1.5) ** 2;
  assert.deepEqual(refined.refinement.boundary, parent.boundary);
  assert.ok(coarse.faces.filter(({ id }) => id !== parent.id).every(
    (face) => refined.faces.includes(face),
  ));
  assert.equal(ellipsoidResidual, 1.0000000000000002);
  assert.equal(refined.vertices.length, 7);
  assert.equal(incidence.size, 15);
  assert.equal(refined.faces.length, 10);
  assert.ok([...incidence.values()].every((count) => count === 2));
  assert.equal(refined.vertices.length - incidence.size + refined.faces.length, 2);
  assert.equal(signedVolume, 13.098076211353316);
});
