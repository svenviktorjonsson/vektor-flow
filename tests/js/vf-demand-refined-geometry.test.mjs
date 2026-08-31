import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCoarseEllipsoidReference,
  refineEllipsoidChildFaceReference,
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

test('face demand is traversal and chunk independent without unrelated detail', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const faceIds = coarse.faces.map(({ id }) => id);
  const summary = (faceId) => {
    const refined = refineEllipsoidFaceReference(coarse, faceId);
    return {
      refinement: refined.refinement,
      generatedVertices: refined.vertices.slice(coarse.vertices.length),
      generatedFaces: refined.faces.filter(({ id }) => id.includes('/refine:1/')),
    };
  };
  const expected = new Map(faceIds.map((faceId) => [faceId, summary(faceId)]));
  const reversed = new Map(
    [...faceIds].reverse().map((faceId) => [faceId, summary(faceId)]),
  );
  assert.deepEqual(
    faceIds.map((faceId) => reversed.get(faceId)),
    faceIds.map((faceId) => expected.get(faceId)),
  );

  const chunks = [faceIds.slice(0, 1), faceIds.slice(1, 6), faceIds.slice(6)];
  const chunked = new Map(
    chunks.flatMap((chunk) => chunk.map((faceId) => [faceId, summary(faceId)])),
  );
  assert.deepEqual(
    faceIds.map((faceId) => chunked.get(faceId)),
    faceIds.map((faceId) => expected.get(faceId)),
  );
  for (const faceId of faceIds) {
    const result = expected.get(faceId);
    assert.equal(result.generatedVertices.length, 1);
    assert.equal(result.generatedFaces.length, 3);
    assert.ok(result.generatedFaces.every(({ id }) => id.startsWith(`${faceId}/refine:1/`)));
  }
});

test('independently refined neighbors retain their exact shared boundary', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const firstId = 'face:+x:+y:+z';
  const secondId = 'face:-x:+y:+z';
  const firstParent = coarse.faces.find(({ id }) => id === firstId);
  const secondParent = coarse.faces.find(({ id }) => id === secondId);
  const shared = firstParent.boundary.filter((edge) => secondParent.boundary.includes(edge));
  const first = refineEllipsoidFaceReference(coarse, firstId);
  const second = refineEllipsoidFaceReference(coarse, secondId);
  const firstChildren = first.faces.filter(({ id }) => id.startsWith(`${firstId}/refine:1/`));
  const secondChildren = second.faces.filter(({ id }) => id.startsWith(`${secondId}/refine:1/`));

  assert.deepEqual(shared, ['edge:vertex:+y|vertex:+z']);
  assert.equal(firstChildren.filter(({ boundary }) => boundary.includes(shared[0])).length, 1);
  assert.equal(secondChildren.filter(({ boundary }) => boundary.includes(shared[0])).length, 1);
  assert.ok(!first.vertices.slice(coarse.vertices.length).some(({ id }) => shared[0].includes(id)));
  assert.ok(!second.vertices.slice(coarse.vertices.length).some(({ id }) => shared[0].includes(id)));
});

test('one demanded child face receives stable hierarchical refinement identities', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const levelOne = refineEllipsoidFaceReference(coarse, 'face:+x:+y:+z');
  const target = 'face:+x:+y:+z/refine:1/child:0';
  const levelTwo = refineEllipsoidChildFaceReference(levelOne, target);

  assert.equal(levelTwo.refinement.level, 2);
  assert.equal(levelTwo.refinement.demand, target);
  assert.deepEqual(levelTwo.refinement.children, [
    `${target}/refine:2/child:0`,
    `${target}/refine:2/child:1`,
    `${target}/refine:2/child:2`,
    `${target}/refine:2/child:3`,
  ]);
  assert.deepEqual(levelTwo.refinement.midpoints, [
    'vertex:midpoint:2:edge:vertex:+x|vertex:+y',
    'vertex:midpoint:2:edge:vertex:+y|vertex:face:+x:+y:+z/refine:1/center',
    'vertex:midpoint:2:edge:vertex:+x|vertex:face:+x:+y:+z/refine:1/center',
  ]);
  assert.equal(levelTwo.refinement.repairs.length, 3);
  assert.deepEqual(levelTwo.refinement.work, {
    demandedFaces: 1,
    conformityFaces: 3,
    generatedVertices: 3,
    generatedFaces: 10,
  });
});

test('level-two demand stays closed and watertight across its conformity ring', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const levelOne = refineEllipsoidFaceReference(coarse, 'face:+x:+y:+z');
  const targetId = 'face:+x:+y:+z/refine:1/child:0';
  const target = levelOne.faces.find(({ id }) => id === targetId);
  const levelTwo = refineEllipsoidChildFaceReference(levelOne, targetId);
  const positions = new Map(levelTwo.vertices.map(({ id, position }) => [id, position]));
  const incidence = new Map();
  let signedVolume = 0;
  let minimumOutwardDot = Infinity;
  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const canonicalEdge = (first, second) => (
    `edge:${[first, second].sort().join('|')}`
  );

  for (const face of levelTwo.faces) {
    face.boundary.forEach((edge) => incidence.set(edge, (incidence.get(edge) ?? 0) + 1));
    const [a, b, c] = face.vertices.map((vertex) => positions.get(vertex));
    const normal = cross(subtract(b, a), subtract(c, a));
    const centroid = a.map((value, index) => (value + b[index] + c[index]) / 3);
    minimumOutwardDot = Math.min(minimumOutwardDot, dot(normal, centroid));
    signedVolume += (
      a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }

  assert.deepEqual(
    levelTwo.vertices.slice(levelOne.vertices.length).map(({ position }) => position),
    [
      [2.1213203435596424, 1.414213562373095, 0],
      [0.9751727510156044, 1.7761476679542303, 0.4875863755078022],
      [2.6642215019313458, 0.6501151673437363, 0.4875863755078022],
    ],
  );
  for (const vertex of levelTwo.vertices.slice(levelOne.vertices.length)) {
    const [x, y, z] = vertex.position;
    assert.ok(Math.abs((x / 3) ** 2 + (y / 2) ** 2 + (z / 1.5) ** 2 - 1) < 1e-15);
  }
  levelTwo.refinement.repairs.forEach((repair, edgeIndex) => {
    const first = target.vertices[edgeIndex];
    const second = target.vertices[(edgeIndex + 1) % 3];
    assert.equal(incidence.has(repair.edge), false);
    assert.equal(incidence.get(canonicalEdge(first, repair.midpoint)), 2);
    assert.equal(incidence.get(canonicalEdge(repair.midpoint, second)), 2);
  });
  const replaced = new Set([
    targetId,
    ...levelTwo.refinement.repairs.map(({ face }) => face),
  ]);
  assert.ok(levelOne.faces.filter(({ id }) => !replaced.has(id)).every(
    (face) => levelTwo.faces.includes(face),
  ));
  assert.equal(levelTwo.vertices.length, 10);
  assert.equal(incidence.size, 24);
  assert.equal(levelTwo.faces.length, 16);
  assert.ok([...incidence.values()].every((count) => count === 2));
  assert.equal(levelTwo.vertices.length - incidence.size + levelTwo.faces.length, 2);
  assert.ok(minimumOutwardDot > 0);
  assert.equal(signedVolume, 14.423964731154435);
});

test('additional refinement accepts only a level-one child on its owning shape', () => {
  const coarse = createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const levelOne = refineEllipsoidFaceReference(coarse, 'face:+x:+y:+z');
  const target = 'face:+x:+y:+z/refine:1/child:0';
  const levelTwo = refineEllipsoidChildFaceReference(levelOne, target);

  assert.throws(
    () => refineEllipsoidChildFaceReference({}, target),
    TypeError,
  );
  assert.throws(
    () => refineEllipsoidChildFaceReference(coarse, target),
    RangeError,
  );
  assert.throws(
    () => refineEllipsoidChildFaceReference(levelOne, 'face:missing'),
    RangeError,
  );
  assert.throws(
    () => refineEllipsoidChildFaceReference(
      levelTwo,
      `${target}/refine:2/child:0`,
    ),
    RangeError,
  );
});

test('hierarchical demand is order and chunk independent with bounded repair work', () => {
  const makeCoarse = () => createCoarseEllipsoidReference({ radii: [3, 2, 1.5] });
  const coarse = makeCoarse();
  const demands = coarse.faces.flatMap(({ id: parentId }) => {
    const levelOne = refineEllipsoidFaceReference(makeCoarse(), parentId);
    return levelOne.refinement.children.map((faceId) => ({ parentId, faceId }));
  });
  const summarize = ({ parentId, faceId }) => {
    const levelOne = refineEllipsoidFaceReference(makeCoarse(), parentId);
    const levelTwo = refineEllipsoidChildFaceReference(levelOne, faceId);
    const replaced = new Set([
      faceId,
      ...levelTwo.refinement.repairs.map(({ face }) => face),
    ]);
    return {
      demand: levelTwo.refinement.demand,
      midpoints: levelTwo.vertices.slice(levelOne.vertices.length),
      generatedFaces: levelTwo.faces.filter((face) => !levelOne.faces.includes(face)),
      preservedFaces: levelTwo.faces.filter((face) => levelOne.faces.includes(face)),
      expectedPreserved: levelOne.faces.filter(({ id }) => !replaced.has(id)),
      work: levelTwo.refinement.work,
    };
  };
  const expected = new Map(demands.map((demand) => [demand.faceId, summarize(demand)]));
  const reversed = new Map(
    [...demands].reverse().map((demand) => [demand.faceId, summarize(demand)]),
  );
  assert.deepEqual(
    demands.map(({ faceId }) => reversed.get(faceId)),
    demands.map(({ faceId }) => expected.get(faceId)),
  );

  const chunks = [demands.slice(0, 2), demands.slice(2, 15), demands.slice(15)];
  const chunked = new Map(chunks.flatMap((chunk) => (
    chunk.map((demand) => [demand.faceId, summarize(demand)])
  )));
  assert.deepEqual(
    demands.map(({ faceId }) => chunked.get(faceId)),
    demands.map(({ faceId }) => expected.get(faceId)),
  );
  for (const { faceId } of demands) {
    const result = expected.get(faceId);
    assert.equal(result.midpoints.length, 3);
    assert.equal(result.generatedFaces.length, 10);
    assert.deepEqual(result.preservedFaces, result.expectedPreserved);
    assert.deepEqual(result.work, {
      demandedFaces: 1,
      conformityFaces: 3,
      generatedVertices: 3,
      generatedFaces: 10,
    });
    assert.ok(result.midpoints.every(({ id }) => id.startsWith('vertex:midpoint:2:edge:')));
    assert.ok(result.generatedFaces.every(({ id }) => (
      id.startsWith(`${faceId}/refine:2/`) || id.includes('/conform:2:')
    )));
  }
});
