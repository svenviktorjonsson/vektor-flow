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

function requireRadii3(radii) {
  const isTypedArray = ArrayBuffer.isView(radii) && !(radii instanceof DataView);
  if ((!Array.isArray(radii) && !isTypedArray) || radii.length !== 3) {
    throw new TypeError('ellipsoid radii must contain exactly three numbers');
  }
  for (let index = 0; index < 3; index += 1) {
    if (typeof radii[index] !== 'number') {
      throw new TypeError(`ellipsoid radius[${index}] must be a number`);
    }
    if (!Number.isFinite(radii[index]) || !(radii[index] > 0)) {
      throw new RangeError(`ellipsoid radius[${index}] must be finite and positive`);
    }
  }
}

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
  requireRadii3(radii);
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
