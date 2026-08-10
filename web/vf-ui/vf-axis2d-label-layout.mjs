export function axis2dCrosshairTickNormal(axis, axes = {}) {
  const x = unit(axes.x, [1, 0]);
  const y = unit(axes.y, [0, -1]);
  if (axis === 'x') return freeze(negate(y));
  if (axis === 'y') return freeze(x);
  throw new TypeError(`Unknown 2D axis: ${axis}`);
}

export function axis2dCrosshairLabelNormal(axis, axes = {}) {
  return freeze(negate(axis2dCrosshairTickNormal(axis, axes)));
}

export function solveAxis2dBoundaryLabel({
  axisOrigin,
  axisDirection,
  preferredNormal,
  labelSize,
  bounds,
  boundaryInset = 20,
  axisGap = 8
} = {}) {
  const origin = point(axisOrigin, 'axisOrigin');
  const direction = unit(axisDirection, null, 'axisDirection');
  const normalHint = unit(preferredNormal, null, 'preferredNormal');
  const [width, height] = size(labelSize, 'labelSize');
  const [viewportWidth, viewportHeight] = size(bounds, 'bounds');
  const inset = Math.max(0, finite(boundaryInset, 20));
  const boundary = boundaryAnchor(
    origin,
    direction,
    inset,
    viewportWidth,
    viewportHeight
  );
  const normal = orthogonalNormal(normalHint, direction);
  const gap = Math.max(0, finite(axisGap, 8));
  const support = 0.5 * (
    Math.abs(normal[0]) * width + Math.abs(normal[1]) * height
  );
  let center = [
    boundary.point[0] + normal[0] * (gap + support),
    boundary.point[1] + normal[1] * (gap + support)
  ];
  const target = boundaryFrameTarget(
    boundary.side,
    [width, height],
    [viewportWidth, viewportHeight],
    inset
  );
  if (target.axis === 0 && Math.abs(direction[0]) > 1e-9) {
    center = add(center, scale(direction, (target.value - center[0]) / direction[0]));
  } else if (target.axis === 1 && Math.abs(direction[1]) > 1e-9) {
    center = add(center, scale(direction, (target.value - center[1]) / direction[1]));
  }
  return Object.freeze({
    left: center[0] - width / 2,
    top: center[1] - height / 2,
    center: freeze(center),
    boundaryPoint: freeze(boundary.point),
    boundarySide: boundary.side,
    normal: freeze(normal)
  });
}

function boundaryAnchor(origin, direction, inset, width, height) {
  const edges = [
    direction[0] > 1e-9 ? { t: (width - inset - origin[0]) / direction[0], side: 'right' } : null,
    direction[0] < -1e-9 ? { t: (inset - origin[0]) / direction[0], side: 'left' } : null,
    direction[1] > 1e-9 ? { t: (height - inset - origin[1]) / direction[1], side: 'bottom' } : null,
    direction[1] < -1e-9 ? { t: (inset - origin[1]) / direction[1], side: 'top' } : null
  ].filter((candidate) => candidate?.t > 0 && Number.isFinite(candidate.t));
  if (!edges.length) throw new RangeError('axisDirection does not reach the viewport boundary.');
  const nearest = edges.reduce((best, candidate) => candidate.t < best.t ? candidate : best);
  return {
    point: add(origin, scale(direction, nearest.t)),
    side: nearest.side
  };
}

function boundaryFrameTarget(side, labelSize, bounds, inset) {
  if (side === 'left') return { axis: 0, value: inset + labelSize[0] / 2 };
  if (side === 'right') return { axis: 0, value: bounds[0] - inset - labelSize[0] / 2 };
  if (side === 'top') return { axis: 1, value: inset + labelSize[1] / 2 };
  return { axis: 1, value: bounds[1] - inset - labelSize[1] / 2 };
}

function orthogonalNormal(normal, direction) {
  const projection = dot(normal, direction);
  const orthogonal = [
    normal[0] - direction[0] * projection,
    normal[1] - direction[1] * projection
  ];
  return unit(orthogonal, [-direction[1], direction[0]]);
}

function point(value, name) {
  if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every(Number.isFinite)) {
    throw new TypeError(`${name} must contain two finite values.`);
  }
  return [Number(value[0]), Number(value[1])];
}

function size(value, name) {
  const result = point(value, name);
  if (!(result[0] > 0) || !(result[1] > 0)) {
    throw new RangeError(`${name} must contain two positive values.`);
  }
  return result;
}

function unit(value, fallback, name = 'vector') {
  let vector;
  try {
    vector = point(value, name);
  } catch (error) {
    if (!fallback) throw error;
    vector = [...fallback];
  }
  const length = Math.hypot(...vector);
  if (!(length > 1e-9)) {
    if (!fallback) throw new RangeError(`${name} must have nonzero length.`);
    return [...fallback];
  }
  return [vector[0] / length, vector[1] / length];
}

function negate(vector) { return [-vector[0], -vector[1]]; }
function scale(vector, scalar) { return [vector[0] * scalar, vector[1] * scalar]; }
function add(left, right) { return [left[0] + right[0], left[1] + right[1]]; }
function dot(left, right) { return left[0] * right[0] + left[1] * right[1]; }
function finite(value, fallback) { return Number.isFinite(value) ? Number(value) : fallback; }
function freeze(value) { return Object.freeze([...value]); }
