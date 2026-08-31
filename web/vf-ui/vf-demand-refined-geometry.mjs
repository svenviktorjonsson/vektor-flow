const FACE_SPECS = Object.freeze([
  ['+x', '+y', '+z'],
  ['-x', '+y', '+z'],
  ['-x', '-y', '+z'],
  ['+x', '-y', '+z'],
  ['+x', '+y', '-z'],
  ['-x', '+y', '-z'],
  ['-x', '-y', '-z'],
  ['+x', '-y', '-z'],
]);

function edgeId(first, second) {
  return `edge:${[first, second].sort().join('|')}`;
}

function frozenVertex(id, position) {
  return Object.freeze({ id, position: Object.freeze(position) });
}

function frozenFace(id, vertices) {
  return Object.freeze({
    id,
    vertices: Object.freeze(vertices),
    boundary: Object.freeze([
      edgeId(vertices[0], vertices[1]),
      edgeId(vertices[1], vertices[2]),
      edgeId(vertices[2], vertices[0]),
    ]),
  });
}

export function createCoarseEllipsoidReference({ radii }) {
  const vertices = Object.freeze([
    frozenVertex('vertex:+x', [radii[0], 0, 0]),
    frozenVertex('vertex:-x', [-radii[0], 0, 0]),
    frozenVertex('vertex:+y', [0, radii[1], 0]),
    frozenVertex('vertex:-y', [0, -radii[1], 0]),
    frozenVertex('vertex:+z', [0, 0, radii[2]]),
    frozenVertex('vertex:-z', [0, 0, -radii[2]]),
  ]);
  const faces = Object.freeze(FACE_SPECS.map((signs) => {
    const signProduct = signs.reduce(
      (product, sign) => product * (sign.startsWith('+') ? 1 : -1),
      1,
    );
    const axisVertices = signs.map((sign) => `vertex:${sign}`);
    const winding = signProduct > 0
      ? axisVertices
      : [axisVertices[0], axisVertices[2], axisVertices[1]];
    return frozenFace(`face:${signs.join(':')}`, winding);
  }));
  return Object.freeze({
    kind: 'ellipsoid-octahedron:v1',
    radii: Object.freeze([...radii]),
    vertices,
    faces,
  });
}
