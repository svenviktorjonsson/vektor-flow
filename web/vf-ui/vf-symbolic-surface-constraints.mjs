const EPSILON = 1e-9;

export function clipSymbolicGeometry3dByConstraints(geometry = {}, constraints = []) {
  const active = Object.freeze((constraints || []).map(normalizeConstraint));
  if (!active.length) return freezeGeometry(geometry, []);

  const triangles = [];
  for (const triangle of geometry.triangles || []) {
    let polygon = triangle.map(point3);
    for (const constraint of active) {
      polygon = clipPolygon(polygon, constraint);
      if (polygon.length < 3) break;
    }
    for (let index = 1; index < polygon.length - 1; index += 1) {
      triangles.push([polygon[0], polygon[index], polygon[index + 1]]);
    }
  }

  const paths = [];
  for (const path of geometry.paths || []) {
    for (let index = 0; index + 1 < path.length; index += 1) {
      const clipped = clipSegment(path[index], path[index + 1], active);
      if (clipped) paths.push(clipped);
    }
  }

  const points = (geometry.points || [])
    .map(point3)
    .filter((point) => active.every((constraint) => inside(constraint, point)));
  const boundaryEdges = inclusiveBoundaryEdges(geometry.triangles || [], active);
  paths.push(...boundaryEdges.map(({ path }) => path));
  return freezeGeometry({ ...geometry, points, paths, triangles }, boundaryEdges);
}

function clipPolygon(polygon, constraint) {
  if (!polygon.length) return [];
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index];
    const to = polygon[(index + 1) % polygon.length];
    const fromResidual = residual(constraint, from);
    const toResidual = residual(constraint, to);
    const fromInside = fromResidual <= EPSILON;
    const toInside = toResidual <= EPSILON;
    if (fromInside && toInside) result.push(to);
    else if (fromInside && !toInside) result.push(intersection(from, to, fromResidual, toResidual));
    else if (!fromInside && toInside) {
      result.push(intersection(from, to, fromResidual, toResidual), to);
    }
  }
  return dedupeAdjacent(result);
}

function clipSegment(fromValue, toValue, constraints, ignoredIndex = -1) {
  let from = point3(fromValue);
  let to = point3(toValue);
  for (let index = 0; index < constraints.length; index += 1) {
    if (index === ignoredIndex) continue;
    const constraint = constraints[index];
    const fromResidual = residual(constraint, from);
    const toResidual = residual(constraint, to);
    const fromInside = fromResidual <= EPSILON;
    const toInside = toResidual <= EPSILON;
    if (!fromInside && !toInside) return null;
    if (fromInside && toInside) continue;
    const crossing = intersection(from, to, fromResidual, toResidual);
    if (fromInside) to = crossing;
    else from = crossing;
  }
  return samePoint(from, to) ? null : [from, to];
}

function inclusiveBoundaryEdges(triangles, constraints) {
  const edges = [];
  const seen = new Set();
  for (let constraintIndex = 0; constraintIndex < constraints.length; constraintIndex += 1) {
    const constraint = constraints[constraintIndex];
    if (!constraint.inclusive) continue;
    for (const triangle of triangles) {
      const crossing = triangleBoundarySegment(triangle, constraint);
      if (!crossing) continue;
      const clipped = clipSegment(crossing[0], crossing[1], constraints, constraintIndex);
      if (!clipped) continue;
      const key = segmentKey(clipped);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(Object.freeze({
        constraintId: constraint.id,
        path: Object.freeze(clipped.map((point) => Object.freeze(point)))
      }));
    }
  }
  return edges;
}

function triangleBoundarySegment(triangle, constraint) {
  const points = triangle.map(point3);
  const crossings = [];
  for (let index = 0; index < 3; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % 3];
    const fromResidual = residual(constraint, from);
    const toResidual = residual(constraint, to);
    if (Math.abs(fromResidual) <= EPSILON) crossings.push(from);
    if ((fromResidual < -EPSILON && toResidual > EPSILON)
      || (fromResidual > EPSILON && toResidual < -EPSILON)) {
      crossings.push(intersection(from, to, fromResidual, toResidual));
    }
  }
  const unique = dedupePoints(crossings);
  return unique.length === 2 && !samePoint(unique[0], unique[1]) ? unique : null;
}

function intersection(from, to, fromResidual, toResidual) {
  const denominator = fromResidual - toResidual;
  const amount = Math.abs(denominator) <= EPSILON ? 0.5 : fromResidual / denominator;
  return from.map((value, axis) => value + (to[axis] - value) * amount);
}

function inside(constraint, point) {
  return residual(constraint, point) <= EPSILON;
}

function residual(constraint, point) {
  const value = Number(constraint.residual(point));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function normalizeConstraint(constraint, index) {
  if (typeof constraint?.residual !== 'function') {
    throw new TypeError('3D symbolic constraints require a residual(point) function.');
  }
  return Object.freeze({
    id: String(constraint.id ?? `constraint:${index}`),
    inclusive: constraint.inclusive === true,
    residual: constraint.residual
  });
}

function freezeGeometry(geometry, boundaryEdges) {
  return Object.freeze({
    ...geometry,
    points: Object.freeze((geometry.points || []).map((point) => Object.freeze(point3(point)))),
    paths: Object.freeze((geometry.paths || []).map((path) => Object.freeze(path.map((point) => Object.freeze(point3(point)))))),
    triangles: Object.freeze((geometry.triangles || []).map((triangle) => Object.freeze(triangle.map((point) => Object.freeze(point3(point)))))),
    boundaryEdges: Object.freeze([...boundaryEdges])
  });
}

function point3(point) {
  if (!Array.isArray(point) || point.length < 3 || !point.slice(0, 3).every(Number.isFinite)) {
    throw new TypeError('3D symbolic geometry points require three finite coordinates.');
  }
  return point.slice(0, 3).map(Number);
}

function dedupeAdjacent(points) {
  const result = [];
  for (const point of points) if (!result.length || !samePoint(result.at(-1), point)) result.push(point);
  if (result.length > 1 && samePoint(result[0], result.at(-1))) result.pop();
  return result;
}

function dedupePoints(points) {
  const result = [];
  for (const point of points) if (!result.some((candidate) => samePoint(candidate, point))) result.push(point);
  return result;
}

function samePoint(left, right) {
  return left.every((value, axis) => Math.abs(value - right[axis]) <= EPSILON);
}

function segmentKey(segment) {
  const encode = (point) => point.map((value) => Math.round(value / EPSILON)).join(',');
  return [encode(segment[0]), encode(segment[1])].sort().join('|');
}
