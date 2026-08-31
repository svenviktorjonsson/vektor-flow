const FACING_EPSILON = 1e-12;
const MAX_REFINEMENT_BUDGET = 64;

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector) {
  const length = Math.sqrt(dot(vector, vector));
  return vector.map((value) => value / length);
}

function cameraBasis(camera) {
  const forward = normalize(subtract(camera.target, camera.eye));
  const right = normalize(cross(forward, camera.up));
  const up = cross(right, forward);
  const focalPixels = camera.viewportHeight
    / (2 * Math.tan(camera.verticalFovRadians / 2));
  return { forward, right, up, focalPixels };
}

function project(position, camera, basis) {
  const relative = subtract(position, camera.eye);
  const depth = dot(relative, basis.forward);
  return [
    basis.focalPixels * dot(relative, basis.right) / depth,
    basis.focalPixels * dot(relative, basis.up) / depth,
  ];
}

function projectedEllipsoidMidpoint(first, second, radii) {
  const average = first.map((value, axis) => (value + second[axis]) / 2);
  const ellipsoidLength = Math.sqrt(average.reduce((sum, value, axis) => (
    sum + (value / radii[axis]) ** 2
  ), 0));
  return average.map((value) => value / ellipsoidLength);
}

function binaryCompare(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function traversalFaces(shape, traversalChunks) {
  if (traversalChunks === undefined) {
    return shape.faces;
  }
  if (
    !Array.isArray(traversalChunks)
    || traversalChunks.some((chunk) => !Array.isArray(chunk))
  ) {
    throw new TypeError('ellipsoid view traversal chunks must be arrays');
  }
  const ids = traversalChunks.flat();
  const faceById = new Map(shape.faces.map((face) => [face.id, face]));
  const uniqueIds = new Set(ids);
  if (
    ids.length !== shape.faces.length
    || uniqueIds.size !== ids.length
    || ids.some((id) => !faceById.has(id))
  ) {
    throw new RangeError(
      'ellipsoid view traversal must contain every face identity exactly once',
    );
  }
  return ids.map((id) => faceById.get(id));
}

export function selectEllipsoidViewDemandReference(shape, {
  camera,
  maxErrorPixels,
  budget,
  traversalChunks,
}) {
  if (typeof budget !== 'number') {
    throw new TypeError('ellipsoid view refinement budget must be a number');
  }
  if (
    !Number.isSafeInteger(budget)
    || budget < 0
    || budget > MAX_REFINEMENT_BUDGET
  ) {
    throw new RangeError(
      `ellipsoid view refinement budget must be an integer from 0 to ${MAX_REFINEMENT_BUDGET}`,
    );
  }
  const visitedFaces = traversalFaces(shape, traversalChunks);
  const positions = new Map(shape.vertices.map(({ id, position }) => [id, position]));
  const basis = cameraBasis(camera);
  const facing = new Map(shape.faces.map((face) => {
    const [a, b, c] = face.vertices.map((id) => positions.get(id));
    const normal = cross(subtract(b, a), subtract(c, a));
    const centroid = a.map((value, axis) => (value + b[axis] + c[axis]) / 3);
    const value = dot(normal, subtract(camera.eye, centroid));
    return [face.id, value < -FACING_EPSILON ? 'back' : 'visible'];
  }));
  const facesByEdge = new Map();
  for (const face of visitedFaces) {
    for (const edge of face.boundary) {
      const incident = facesByEdge.get(edge) ?? [];
      incident.push(face.id);
      facesByEdge.set(edge, incident);
    }
  }
  const centerDepth = dot(camera.eye.map((value) => -value), basis.forward);
  const supportDepth = Math.sqrt(shape.radii.reduce((sum, radius, axis) => (
    sum + (radius * basis.forward[axis]) ** 2
  ), 0));
  const supportHorizontal = Math.sqrt(shape.radii.reduce((sum, radius, axis) => (
    sum + (radius * basis.right[axis]) ** 2
  ), 0));
  const minimumDepth = centerDepth - supportDepth;
  const maximumRadius = Math.max(...shape.radii);
  const culled = [];
  const candidates = [];

  for (const face of shape.faces) {
    if (facing.get(face.id) === 'back') {
      culled.push(face.id);
      continue;
    }
    const edgeRecords = face.vertices.map((firstId, index) => {
      const secondId = face.vertices[(index + 1) % 3];
      const edge = face.boundary[index];
      const first = positions.get(firstId);
      const second = positions.get(secondId);
      const midpoint = projectedEllipsoidMidpoint(first, second, shape.radii);
      const firstProjected = project(first, camera, basis);
      const secondProjected = project(second, camera, basis);
      const midpointProjected = project(midpoint, camera, basis);
      const chordMidpoint = firstProjected.map((value, axis) => (
        (value + secondProjected[axis]) / 2
      ));
      const projectedErrorPixels = Math.hypot(
        midpointProjected[0] - chordMidpoint[0],
        midpointProjected[1] - chordMidpoint[1],
      );
      const firstUnit = first.map((value, axis) => value / shape.radii[axis]);
      const secondUnit = second.map((value, axis) => value / shape.radii[axis]);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(firstUnit, secondUnit))));
      const worldDeviationBound = maximumRadius * (1 - Math.cos(angle / 2));
      const errorBoundPixels = basis.focalPixels * worldDeviationBound * (
        1 / minimumDepth + supportHorizontal / minimumDepth ** 2
      );
      const incident = facesByEdge.get(edge);
      const silhouette = incident.some((faceId) => facing.get(faceId) === 'back');
      return { edge, errorBoundPixels, projectedErrorPixels, silhouette };
    });
    const silhouetteEdges = edgeRecords.filter(({ silhouette }) => silhouette);
    const errorBoundPixels = Math.max(...edgeRecords.map((edge) => edge.errorBoundPixels));
    const projectedErrorPixels = Math.max(
      ...edgeRecords.map((edge) => edge.projectedErrorPixels),
    );
    if (errorBoundPixels > maxErrorPixels) {
      candidates.push(Object.freeze({
        face: face.id,
        silhouette: silhouetteEdges.length > 0,
        silhouetteEdges: Object.freeze(silhouetteEdges.map(({ edge }) => edge)),
        silhouetteErrorPixels: silhouetteEdges.length === 0
          ? 0
          : Math.max(...silhouetteEdges.map((edge) => edge.projectedErrorPixels)),
        projectedErrorPixels,
        errorBoundPixels,
      }));
    }
  }
  candidates.sort((first, second) => (
    Number(second.silhouette) - Number(first.silhouette)
    || second.silhouetteErrorPixels - first.silhouetteErrorPixels
    || second.projectedErrorPixels - first.projectedErrorPixels
    || second.errorBoundPixels - first.errorBoundPixels
    || binaryCompare(first.face, second.face)
  ));
  const canonicalFaceIndex = new Map(shape.faces.map(({ id }, index) => [id, index]));
  culled.sort((first, second) => (
    canonicalFaceIndex.get(first) - canonicalFaceIndex.get(second)
  ));
  return Object.freeze({
    demands: Object.freeze(candidates.slice(0, budget).map(({ face }) => face)),
    candidates: Object.freeze(candidates),
    culled: Object.freeze(culled),
    budget,
    maxErrorPixels,
  });
}
