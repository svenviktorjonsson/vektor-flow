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
const COARSE_FACE_IDS = new Set(FACE_SPECS.map((signs) => `face:${signs.join(':')}`));
const shapeInstances = new WeakSet();

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
  const shape = Object.freeze({
    kind: 'ellipsoid-octahedron:v1',
    radii: Object.freeze([...radii]),
    vertices,
    faces,
  });
  shapeInstances.add(shape);
  return shape;
}

export function refineEllipsoidFaceReference(shape, faceId) {
  if (!shape || typeof shape !== 'object' || !shapeInstances.has(shape)) {
    throw new TypeError('ellipsoid reference shape is required');
  }
  if (typeof faceId !== 'string') {
    throw new TypeError('ellipsoid face identity must be a string');
  }
  if (!COARSE_FACE_IDS.has(faceId)) {
    throw new RangeError(`ellipsoid coarse face is unavailable: ${faceId}`);
  }
  const face = shape.faces.find(({ id }) => id === faceId);
  if (!face) {
    throw new RangeError(`ellipsoid coarse face is unavailable: ${faceId}`);
  }
  const positions = new Map(shape.vertices.map(({ id, position }) => [id, position]));
  const average = [0, 1, 2].map((axis) => (
    face.vertices.reduce((sum, vertex) => sum + positions.get(vertex)[axis], 0) / 3
  ));
  const centerId = `vertex:${faceId}/refine:1/center`;
  const center = frozenVertex(
    centerId,
    average.map((value, axis) => (
      Math.sign(value) * shape.radii[axis] / Math.sqrt(3)
    )),
  );
  const children = Object.freeze(face.vertices.map((vertex, index) => frozenFace(
    `${faceId}/refine:1/child:${index}`,
    [vertex, face.vertices[(index + 1) % 3], centerId],
  )));
  const faces = Object.freeze(shape.faces.flatMap((candidate) => (
    candidate.id === faceId ? children : [candidate]
  )));
  const refined = Object.freeze({
    ...shape,
    vertices: Object.freeze([...shape.vertices, center]),
    faces,
    refinement: Object.freeze({
      face: faceId,
      center: centerId,
      children: Object.freeze(children.map(({ id }) => id)),
      boundary: face.boundary,
    }),
  });
  shapeInstances.add(refined);
  return refined;
}
