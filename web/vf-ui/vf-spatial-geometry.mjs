const EPSILON = 1e-8;

export function nearestSpatialPointToLine(points, {
  linePoint,
  lineDirection,
  cameraForward = lineDirection
} = {}) {
  const candidates = requirePoints(points, 1);
  const origin = vec3(linePoint);
  const direction = normalize(lineDirection);
  const forward = normalize(cameraForward);
  const ranked = candidates.map((point, index) => {
    const delta = subtract(point, origin);
    const lineParameter = dot(delta, direction);
    const closest = add(origin, scale(direction, lineParameter));
    return {
      index,
      point,
      distance: magnitude(subtract(point, closest)),
      lineParameter,
      visualDepth: dot(delta, forward)
    };
  }).sort((left, right) => {
    const distanceDelta = left.distance - right.distance;
    return Math.abs(distanceDelta) > EPSILON
      ? distanceDelta
      : left.visualDepth - right.visualDepth || left.index - right.index;
  });
  const nearest = ranked[0];
  return Object.freeze({
    index: nearest.index,
    point: Object.freeze([...nearest.point]),
    distance: nearest.distance,
    lineParameter: nearest.lineParameter
  });
}

export function constrainSpatialPointDrag({
  originalPoint,
  incidentPolygons = [],
  linePoint,
  lineDirection,
  minimumPlaneVertices = 4
} = {}) {
  const origin = vec3(originalPoint);
  const cursorLinePoint = vec3(linePoint);
  const cursorLineDirection = normalize(lineDirection);
  const minimumVertices = Math.max(3, Math.trunc(Number(minimumPlaneVertices)) || 4);
  const normals = [];
  for (const polygon of incidentPolygons) {
    if (!Array.isArray(polygon) || polygon.length < minimumVertices) continue;
    const points = requirePoints(polygon, minimumVertices);
    let normal;
    try {
      normal = polygonNormal(points);
    } catch {
      continue;
    }
    if (normals.length === 0) {
      normals.push(normal);
      continue;
    }
    if (normals.length === 1) {
      if (magnitude(cross3(normals[0], normal)) > EPSILON) normals.push(normal);
      continue;
    }
    const intersectionDirection = normalize(cross3(normals[0], normals[1]));
    if (Math.abs(dot(intersectionDirection, normal)) > EPSILON) {
      normals.push(normal);
      break;
    }
  }
  const planeCount = normals.length;
  if (planeCount === 0) {
    return Object.freeze({ point: null, freedom: 3, planeCount: 0 });
  }
  if (planeCount >= 3) {
    return freezeDragConstraint(origin, 0, planeCount);
  }
  const denominator = dot(cursorLineDirection, normals[0]);
  if (Math.abs(denominator) <= EPSILON) {
    return freezeDragConstraint(origin, 3 - planeCount, planeCount);
  }
  const lineParameter = dot(subtract(origin, cursorLinePoint), normals[0]) / denominator;
  const planeTarget = add(cursorLinePoint, scale(cursorLineDirection, lineParameter));
  if (planeCount === 1) {
    return freezeDragConstraint(planeTarget, 2, planeCount);
  }
  const constraintDirection = normalize(cross3(normals[0], normals[1]));
  const projectedDistance = dot(subtract(planeTarget, origin), constraintDirection);
  return freezeDragConstraint(
    add(origin, scale(constraintDirection, projectedDistance)),
    1,
    planeCount
  );
}

export function projectSpatialPointsToDominantPlane(points, { sampleIndices = null } = {}) {
  const spatialPoints = requirePoints(points, 1);
  const indices = sampleIndices == null
    ? spatialPoints.map((_, index) => index)
    : [...new Set(sampleIndices.map(Number))];
  if (!indices.length || indices.some((index) => !Number.isInteger(index) || !spatialPoints[index])) {
    throw new RangeError('Dominant-plane samples must reference spatial points.');
  }
  const samples = indices.map((index) => spatialPoints[index]);
  let axes = [0, 1];
  let bestAreaScore = -1;
  for (const candidate of [[0,1], [0,2], [1,2]]) {
    const [first, second] = candidate;
    const centerFirst = samples.reduce((sum, point) => sum + point[first], 0) / samples.length;
    const centerSecond = samples.reduce((sum, point) => sum + point[second], 0) / samples.length;
    let firstVariance = 0;
    let secondVariance = 0;
    let covariance = 0;
    for (const point of samples) {
      const a = point[first] - centerFirst;
      const b = point[second] - centerSecond;
      firstVariance += a * a;
      secondVariance += b * b;
      covariance += a * b;
    }
    const areaScore = firstVariance * secondVariance - covariance * covariance;
    if (areaScore > bestAreaScore) {
      bestAreaScore = areaScore;
      axes = candidate;
    }
  }
  return Object.freeze({
    axes: Object.freeze([...axes]),
    points: Object.freeze(spatialPoints.map((point) => Object.freeze([
      point[axes[0]], point[axes[1]]
    ])))
  });
}

export function cameraFacingPolygonFrame(points, { cameraPosition = null } = {}) {
  const polygon = requirePoints(points, 3);
  const center = scale(polygon.reduce(add, [0, 0, 0]), 1 / polygon.length);
  let normal = polygonNormal(polygon);
  if (Array.isArray(cameraPosition) && dot(normal, subtract(vec3(cameraPosition), center)) < 0) {
    normal = scale(normal, -1);
  }
  return Object.freeze({ center: Object.freeze(center), normal: Object.freeze(normal) });
}

export function guidedPlaneExtrusionPositions(points, {
  normal,
  distance,
  guides = []
} = {}) {
  const polygon = requirePoints(points, 3);
  const planeNormal = normalize(normal);
  const amount = finite(distance, 'extrusion distance');
  return Object.freeze(polygon.map((point, index) => {
    const directions = (guides[index] || [])
      .map((guide) => subtract(vec3(guide), point))
      .filter((direction) => magnitude(direction) > EPSILON && Math.abs(dot(direction, planeNormal)) > EPSILON)
      .map(normalize)
      .map((direction) => dot(direction, planeNormal) < 0 ? scale(direction, -1) : direction);
    const combined = directions.length ? normalize(directions.reduce(add, [0, 0, 0])) : null;
    const guide = combined && Math.abs(dot(combined, planeNormal)) > EPSILON ? combined : planeNormal;
    return Object.freeze(add(point, scale(guide, amount / dot(guide, planeNormal))));
  }));
}

export function projectedNormalDragDistance({
  startScreen,
  currentScreen,
  normalScreenVector = null,
  orthoScale,
  viewportHeight,
  minimumProjectedFraction = 0.15
} = {}) {
  const height = Math.max(1, finite(viewportHeight, 'viewport height'));
  const worldPerPixel = 2 * Math.max(EPSILON, finite(orthoScale, 'orthographic scale')) / height;
  const screenNormal = Array.isArray(normalScreenVector) ? normalScreenVector.map(Number) : null;
  const screenNormalLength = screenNormal ? Math.hypot(...screenNormal) : 0;
  if (screenNormalLength > minimumProjectedFraction / worldPerPixel) {
    const delta = [
      Number(currentScreen?.[0]) - Number(startScreen?.[0]),
      Number(currentScreen?.[1]) - Number(startScreen?.[1])
    ];
    return dot2(delta, screenNormal) / (screenNormalLength * screenNormalLength);
  }
  return (Number(startScreen?.[1]) - Number(currentScreen?.[1])) * worldPerPixel;
}

export function closeLinkedSpatialGeometry({ points = [], segments = [], faces = [] } = {}) {
  const spatialPoints = requirePoints(points, 0);
  const closedFaces = faces.map((face) => [...face]);
  inferEdgeCycles(spatialPoints.length, segments, (cycle) => {
    const key = canonicalCycleKey(cycle);
    if (!closedFaces.some((face) => canonicalCycleKey(face) === key)) closedFaces.push(cycle);
  });
  const orientation = closedShellOrientations(closedFaces);
  return Object.freeze({
    points: Object.freeze(spatialPoints.map(Object.freeze)),
    segments: Object.freeze(segments.map((segment) => Object.freeze([...segment]))),
    faces: Object.freeze(closedFaces.map((face) => Object.freeze([...face]))),
    volumes: Object.freeze(orientation ? [Object.freeze(orientation)] : [])
  });
}

export function closedFacesFromCornerWalk(vertices) {
  const walk = Array.isArray(vertices) ? vertices.map(Number) : [];
  const path = [];
  const faces = [];
  for (const vertex of walk) {
    const previous = path.lastIndexOf(vertex);
    if (previous < 0) {
      path.push(vertex);
      continue;
    }
    const cycle = path.slice(previous);
    if (new Set(cycle).size >= 3) faces.push(Object.freeze(cycle));
    path.splice(previous + 1);
  }
  return Object.freeze(faces);
}

export function volumeCutPlanePolygons(triangles, {
  planePoint,
  planeNormal,
  orthoScale,
  proximity = 2
} = {}) {
  const valid = (triangles || []).filter((triangle) => (
    Array.isArray(triangle) && triangle.length === 3 && triangle.every(finitePoint)
  ));
  if (!valid.length) return Object.freeze([]);
  const normal = normalize(planeNormal);
  const point = vec3(planePoint);
  if (finite(orthoScale, 'orthographic scale') > boundingDiagonal(valid.flat()) * proximity) {
    return Object.freeze([]);
  }
  const segments = valid.map((triangle) => intersectTriangle(triangle, point, normal)).filter(Boolean);
  return Object.freeze(stitchLoops(segments).map((loop) => Object.freeze(loop.map(Object.freeze))));
}

export function spatialFrameFromDirections({
  origin = [0, 0, 0],
  directions = [],
  globalUp = [0, 0, 1]
} = {}) {
  const frameOrigin = vec3(origin);
  const axes = (Array.isArray(directions) ? directions : [])
    .map(vec3)
    .filter((direction) => magnitude(direction) > EPSILON)
    .slice(0, 3)
    .map(normalize);
  if (!axes.length) {
    return freezeFrame(frameOrigin, [1,0,0], [0,1,0], [0,0,1], 0);
  }
  if (axes.length === 1) {
    const xAxis = axes[0];
    let zAxis = normalize(globalUp);
    if (magnitude(cross3(zAxis, xAxis)) <= EPSILON) {
      zAxis = Math.abs(xAxis[1]) < 0.9 ? [0,1,0] : [1,0,0];
    }
    const yAxis = normalize(cross3(zAxis, xAxis));
    zAxis = normalize(cross3(xAxis, yAxis));
    return freezeFrame(frameOrigin, xAxis, yAxis, zAxis, 1);
  }
  const crossAxis = cross3(axes[0], axes[1]);
  if (magnitude(crossAxis) <= EPSILON) {
    throw new RangeError('Selected spatial directions must be independent.');
  }
  const zAxis = axes.length >= 3 ? axes[2] : normalize(crossAxis);
  if (axes.length >= 3 && Math.abs(dot(normalize(crossAxis), zAxis)) <= EPSILON) {
    throw new RangeError('Three selected spatial directions must span a volume.');
  }
  return freezeFrame(frameOrigin, axes[0], axes[1], zAxis, axes.length);
}

export function lexicographicMinimumPoint(points) {
  const values = requirePoints(points, 1);
  return Object.freeze([...values].sort((left, right) => (
    left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
  ))[0]);
}

export function clipSpatialGeometryToConvexVolume(geometry = {}, shellTriangles = []) {
  const triangles = (shellTriangles || []).filter((triangle) => (
    Array.isArray(triangle) && triangle.length === 3 && triangle.every(finitePoint)
  ));
  if (!triangles.length) return freezeSpatialGeometry(geometry);
  const shellPoints = uniquePoints(triangles.flat().map(vec3));
  const center = scale(shellPoints.reduce(add, [0,0,0]), 1 / shellPoints.length);
  const planes = triangles.map((triangle) => {
    const point = vec3(triangle[0]);
    let normal = normalize(cross3(subtract(triangle[1], point), subtract(triangle[2], point)));
    if (dot(subtract(center, point), normal) > 0) normal = scale(normal, -1);
    return { point, normal };
  });
  const points = (geometry.points || []).filter((point) => insidePlanes(point, planes)).map(vec3);
  const paths = (geometry.paths || []).flatMap((path) => {
    const segments = [];
    for (let index = 1; index < path.length; index += 1) {
      const segment = clipSegmentToPlanes(path[index - 1], path[index], planes);
      if (segment) segments.push(segment);
    }
    return segments;
  });
  const clippedTriangles = (geometry.triangles || []).flatMap((triangle) => {
    let polygon = triangle.map(vec3);
    for (const plane of planes) polygon = clipPolygonToPlane(polygon, plane);
    if (polygon.length < 3) return [];
    return Array.from({ length: polygon.length - 2 }, (_, index) => (
      [polygon[0], polygon[index + 1], polygon[index + 2]]
    ));
  });
  return freezeSpatialGeometry({ ...geometry, points, paths, triangles: clippedTriangles });
}

function polygonNormal(points) {
  const normal = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    normal[0] += (point[1] - next[1]) * (point[2] + next[2]);
    normal[1] += (point[2] - next[2]) * (point[0] + next[0]);
    normal[2] += (point[0] - next[0]) * (point[1] + next[1]);
  }
  return normalize(normal);
}

function freezeFrame(origin, xAxis, yAxis, zAxis, dimension) {
  return Object.freeze({
    origin: Object.freeze(cleanVector(origin)),
    xAxis: Object.freeze(cleanVector(xAxis)),
    yAxis: Object.freeze(cleanVector(yAxis)),
    zAxis: Object.freeze(cleanVector(zAxis)),
    dimension
  });
}

function insidePlanes(point, planes) {
  const value = vec3(point);
  return planes.every((plane) => dot(subtract(value, plane.point), plane.normal) <= EPSILON);
}

function clipSegmentToPlanes(fromValue, toValue, planes) {
  const from = vec3(fromValue);
  const to = vec3(toValue);
  const direction = subtract(to, from);
  let minimum = 0;
  let maximum = 1;
  for (const plane of planes) {
    const start = dot(subtract(from, plane.point), plane.normal);
    const change = dot(direction, plane.normal);
    if (Math.abs(change) <= EPSILON) {
      if (start > EPSILON) return null;
      continue;
    }
    const crossing = -start / change;
    if (change > 0) maximum = Math.min(maximum, crossing);
    else minimum = Math.max(minimum, crossing);
    if (minimum > maximum + EPSILON) return null;
  }
  return [add(from, scale(direction, minimum)), add(from, scale(direction, maximum))];
}

function clipPolygonToPlane(polygon, plane) {
  if (!polygon.length) return [];
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const fromDistance = dot(subtract(from, plane.point), plane.normal);
    const toDistance = dot(subtract(to, plane.point), plane.normal);
    const fromInside = fromDistance <= EPSILON;
    const toInside = toDistance <= EPSILON;
    if (fromInside) result.push(from);
    if (fromInside === toInside) continue;
    const amount = fromDistance / (fromDistance - toDistance);
    result.push(from.map((value, axis) => value + (to[axis] - value) * amount));
  }
  return uniquePoints(result);
}

function freezeSpatialGeometry(geometry) {
  return Object.freeze({
    ...geometry,
    points: Object.freeze((geometry.points || []).map((point) => Object.freeze(vec3(point)))),
    paths: Object.freeze((geometry.paths || []).map((path) => Object.freeze(path.map((point) => Object.freeze(vec3(point)))))),
    triangles: Object.freeze((geometry.triangles || []).map((triangle) => Object.freeze(triangle.map((point) => Object.freeze(vec3(point))))))
  });
}

function inferEdgeCycles(pointCount, edges, addFace) {
  const adjacency = Array.from({ length: pointCount }, () => []);
  for (const [from, to] of edges) { adjacency[from].push(to); adjacency[to].push(from); }
  const visited = new Set();
  for (let start = 0; start < pointCount; start += 1) {
    if (visited.has(start) || adjacency[start].length !== 2) continue;
    const cycle = [start];
    let previous = -1;
    let current = start;
    while (true) {
      visited.add(current);
      const next = adjacency[current].find((candidate) => candidate !== previous);
      if (next === start) break;
      if (next == null || cycle.includes(next) || adjacency[next].length !== 2) { cycle.length = 0; break; }
      cycle.push(next); previous = current; current = next;
    }
    if (cycle.length >= 3) addFace(cycle);
  }
}

function closedShellOrientations(faces) {
  if (faces.length < 4) return null;
  const incidence = new Map();
  faces.forEach((face, faceIndex) => face.forEach((from, index) => {
    const to = face[(index + 1) % face.length];
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    const direction = from < to ? 1 : -1;
    if (!incidence.has(key)) incidence.set(key, []);
    incidence.get(key).push({ faceIndex, direction });
  }));
  if ([...incidence.values()].some((uses) => uses.length !== 2)) return null;
  const orientation = Array(faces.length).fill(0); orientation[0] = 1;
  const queue = [0];
  while (queue.length) {
    const faceIndex = queue.shift();
    for (const uses of incidence.values()) {
      const here = uses.find((use) => use.faceIndex === faceIndex);
      if (!here) continue;
      const other = uses.find((use) => use.faceIndex !== faceIndex);
      const required = -orientation[faceIndex] * here.direction * other.direction;
      if (orientation[other.faceIndex] && orientation[other.faceIndex] !== required) return null;
      if (!orientation[other.faceIndex]) { orientation[other.faceIndex] = required; queue.push(other.faceIndex); }
    }
  }
  return orientation.every(Boolean) ? orientation : null;
}

function intersectTriangle(triangle, planePoint, normal) {
  const distances = triangle.map((point) => dot(subtract(point, planePoint), normal));
  const intersections = [];
  for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
    const a = distances[from]; const b = distances[to];
    if (Math.abs(a) <= EPSILON) intersections.push(triangle[from]);
    if ((a < -EPSILON && b > EPSILON) || (a > EPSILON && b < -EPSILON)) {
      const amount = a / (a - b);
      intersections.push(triangle[from].map((value, axis) => value + (triangle[to][axis] - value) * amount));
    }
  }
  const unique = uniquePoints(intersections);
  return unique.length === 2 ? unique : null;
}

function stitchLoops(segments) {
  const remaining = segments.map(([from, to]) => [[...from], [...to]]);
  const loops = [];
  while (remaining.length) {
    const [first] = remaining.splice(0, 1); const loop = [...first];
    while (!samePoint(loop.at(-1), loop[0])) {
      const index = remaining.findIndex(([from, to]) => samePoint(from, loop.at(-1)) || samePoint(to, loop.at(-1)));
      if (index < 0) break;
      const [segment] = remaining.splice(index, 1);
      loop.push(samePoint(segment[0], loop.at(-1)) ? segment[1] : segment[0]);
    }
    if (loop.length >= 4 && samePoint(loop.at(-1), loop[0])) loops.push(loop.slice(0, -1));
  }
  return loops;
}

function canonicalCycleKey(cycle) {
  const rotations = [];
  for (const values of [cycle, [...cycle].reverse()]) for (let offset = 0; offset < values.length; offset += 1) {
    rotations.push([...values.slice(offset), ...values.slice(0, offset)].join(':'));
  }
  return rotations.sort()[0];
}

function uniquePoints(points) { const result = []; for (const point of points) if (!result.some((item) => samePoint(item, point))) result.push(point); return result; }
function boundingDiagonal(points) { const min = [0,1,2].map((a) => Math.min(...points.map((p) => p[a]))); const max = [0,1,2].map((a) => Math.max(...points.map((p) => p[a]))); return Math.hypot(...max.map((v,a) => v-min[a])); }
function samePoint(a,b) { return Math.hypot(...a.map((v,i) => v-b[i])) <= EPSILON; }
function finitePoint(point) { return Array.isArray(point) && point.length >= 3 && point.slice(0,3).every(Number.isFinite); }
function requirePoints(points, minimum) { if (!Array.isArray(points) || points.length < minimum || !points.every(finitePoint)) throw new TypeError('Spatial geometry requires finite 3D points.'); return points.map(vec3); }
function vec3(value) { return [0,1,2].map((axis) => finite(value?.[axis] ?? 0, '3D coordinate')); }
function add(a,b) { return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function subtract(a,b) { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function scale(v,s) { return v.map((value) => value*s); }
function dot(a,b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross3(a,b) { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function dot2(a,b) { return a[0]*b[0]+a[1]*b[1]; }
function magnitude(v) { return Math.hypot(...v); }
function normalize(v) { const value=vec3(v); const size=magnitude(value); if(size<=EPSILON) throw new RangeError('Spatial direction must be non-zero.'); return scale(value,1/size); }
function cleanVector(value) { return value.map((entry) => Math.abs(entry) <= EPSILON ? 0 : entry); }
function freezeDragConstraint(point, freedom, planeCount) { return Object.freeze({ point:Object.freeze(cleanVector(point)), freedom, planeCount }); }
function finite(value,label) { const number=Number(value); if(!Number.isFinite(number)) throw new TypeError(`${label} must be finite.`); return number; }
