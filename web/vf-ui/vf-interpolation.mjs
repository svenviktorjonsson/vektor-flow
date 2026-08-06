const EPSILON = 1e-12;

export const DEFAULT_INTERPOLATION_STYLE = Object.freeze({
  id: 'linear',
  name: 'Linear',
  type: 'linear',
  order: 1,
  tension: 0.5,
  linearStyle: 'lines',
  linearArrowMode: 'absolute',
  linearArrowRelativeMode: 'end',
  linearArrowRelativeValue: 0,
  linearArrowAbsoluteMode: 'dist',
  linearArrowAbsoluteValue: 1
});

export function normalizeInterpolationStyle(style = {}) {
  const legacyType = ({ cubic_spline: 'spline', nurbs: 'spline', circular_arc: 'radius' })[style.type]
    || style.type;
  const type = ['linear', 'spline', 'radius', 'smoothing', 'fractal'].includes(legacyType)
    ? legacyType
    : DEFAULT_INTERPOLATION_STYLE.type;
  const rawPointHandling = style.pointHandling ?? style.nurbsPointMode ?? style.nurbs_point_mode;
  const pointHandling = ({ control_only: 'control', anchor_only: 'anchor' })[rawPointHandling]
    || (['anchor', 'control', 'mixed'].includes(rawPointHandling) ? rawPointHandling : undefined);
  return Object.freeze({
    id: String(style.id || DEFAULT_INTERPOLATION_STYLE.id),
    name: String(style.name || title(type)),
    type,
    order: style.order == null ? (type === 'linear' ? 1 : 3) : (Number(style.order) === 3 ? 3 : 1),
    tension: clamp(Number(style.tension ?? 0.5), 0, 1),
    linearStyle: style.linearStyle === 'arrows' ? 'arrows' : 'lines',
    linearArrowMode: style.linearArrowMode === 'relative' ? 'relative' : 'absolute',
    linearArrowRelativeMode: style.linearArrowRelativeMode === 'over' ? 'over' : 'end',
    linearArrowRelativeValue: clamp(Number(style.linearArrowRelativeValue ?? 0), 0, 1),
    linearArrowAbsoluteMode: style.linearArrowAbsoluteMode === 'length' ? 'length' : 'dist',
    linearArrowAbsoluteValue: Math.max(0, finite(style.linearArrowAbsoluteValue, 1)),
    ...(pointHandling ? { pointHandling } : {}),
    ...(style.nurbsMixedRule || style.nurbs_mixed_rule
      ? { mixedRule: style.nurbsMixedRule || style.nurbs_mixed_rule }
      : {}),
    ...(style.cornerHandling || style.corner_handling
      ? { cornerHandling: style.cornerHandling || style.corner_handling }
      : {}),
    ...(style.nurbsSide || style.nurbs_side || style.nurbsMixedSide
      ? { mixedSide: style.nurbsSide || style.nurbs_side || style.nurbsMixedSide }
      : {})
  });
}

export function interpolateDirectedPath(points, style = {}, samplesPerSegment = 24) {
  const source = normalizePoints(points);
  if (source.length < 2) return Object.freeze(source);
  const normalized = normalizeInterpolationStyle(style);
  if (normalized.type === 'linear' || normalized.order === 1) return freezePath(source);
  if (normalized.pointHandling === 'mixed') {
    return freezePath(catmullRom(
      mixedCornerPoints(source, normalized.mixedSide),
      normalized.tension,
      Math.max(2, Math.round(samplesPerSegment))
    ));
  }
  if (normalized.type === 'smoothing' || normalized.pointHandling === 'control') {
    return freezePath(chaikin(source, Math.max(1, Math.min(5, samplesPerSegment / 4))));
  }
  if (normalized.type === 'fractal') return freezePath(fractalize(source, Math.max(1, Math.min(5, samplesPerSegment / 8))));
  return freezePath(catmullRom(source, normalized.tension, Math.max(2, Math.round(samplesPerSegment))));
}

export function interpolatedTopologyEdgePath(graph, edgeId, styles = [], samplesPerSegment = 24) {
  const edges = graphEdges(graph);
  const edge = edges.find(({ id }) => id === edgeId);
  if (!edge || edge.vertices?.length !== 2) return Object.freeze({ interactionPath: Object.freeze([]), visualPath: Object.freeze([]) });
  const positions = vertexPositions(graph);
  const interactionPath = freezePath(edge.vertices.map((id) => positions.get(id)).filter(Boolean));
  const styleId = edge.properties?.interpolationStyleId;
  const style = resolveStyle(styles, styleId);
  if (!style || interactionPath.length !== 2) return Object.freeze({ interactionPath, visualPath: interactionPath });

  const chain = styledEdgeChain(edges, edge, styleId);
  const chainPoints = chain.vertexIds.map((id) => positions.get(id)).filter(Boolean);
  if (chainPoints.length !== chain.vertexIds.length) return Object.freeze({ interactionPath, visualPath: interactionPath });
  const fullPath = interpolateDirectedPath(chainPoints, style, samplesPerSegment);
  const segmentCount = chain.edgeIds.length;
  const edgeIndex = chain.edgeIds.indexOf(edgeId);
  const startIndex = Math.round(edgeIndex * (fullPath.length - 1) / segmentCount);
  const endIndex = Math.round((edgeIndex + 1) * (fullPath.length - 1) / segmentCount);
  let visualPath = fullPath.slice(startIndex, endIndex + 1).map((point) => [...point]);
  const chainFrom = chain.vertexIds[edgeIndex];
  if (chainFrom !== edge.vertices[0]) visualPath.reverse();
  if (visualPath.length < 2) visualPath = interactionPath.map((point) => [...point]);
  visualPath[0] = [...interactionPath[0]];
  visualPath[visualPath.length - 1] = [...interactionPath[1]];
  return Object.freeze({ interactionPath, visualPath: freezePath(visualPath) });
}

export function interpolatedFaceBoundary(graph, faceId, styles = [], samplesPerSegment = 24) {
  const face = (graph.faces || []).find(({ id }) => id === faceId);
  if (!face?.vertices?.length) return Object.freeze([]);
  const positions = vertexPositions(graph);
  const edges = graphEdges(graph);
  const boundary = [];
  face.vertices.forEach((from, index, vertices) => {
    const to = vertices[(index + 1) % vertices.length];
    const edge = edges.find(({ vertices: ids = [] }) => ids.length === 2 && ids.includes(from) && ids.includes(to));
    let path = edge
      ? interpolatedTopologyEdgePath(graph, edge.id, styles, samplesPerSegment).visualPath.map((point) => [...point])
      : [positions.get(from), positions.get(to)].filter(Boolean).map((point) => [...point]);
    if (edge?.vertices[0] !== from) path.reverse();
    boundary.push(...(boundary.length ? path.slice(1) : path));
  });
  if (boundary.length && !samePoint(boundary[0], boundary.at(-1))) boundary.push([...boundary[0]]);
  return freezePath(boundary);
}

export function closestInterpolatedPathContact(path, point, {
  closed = false,
  normalSide = 'left'
} = {}) {
  const points = normalizePoints(path);
  const target = normalizePoints([point])[0];
  if (!target || points.length < 2) return null;
  const alreadyClosed = samePoint(points[0], points.at(-1));
  const segmentCount = points.length - 1 + (closed && !alreadyClosed ? 1 : 0);
  const useLeftNormal = closed
    ? signedPathArea(points) < 0
    : normalSide !== 'right';
  let best = null;
  for (let index = 0; index < segmentCount; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const edge = subtract(to, from);
    const lengthSquared = edge[0] * edge[0] + edge[1] * edge[1];
    if (lengthSquared <= EPSILON) continue;
    const ratio = clamp(
      ((target[0] - from[0]) * edge[0] + (target[1] - from[1]) * edge[1]) / lengthSquared,
      0,
      1
    );
    const contactPoint = lerp(from, to, ratio);
    const delta = subtract(target, contactPoint);
    const distanceSquared = delta[0] * delta[0] + delta[1] * delta[1];
    if (best && distanceSquared >= best.distanceSquared) continue;
    const tangent = contactTangent(points, index, ratio, segmentCount, closed || alreadyClosed);
    const normal = useLeftNormal
      ? [-tangent[1], tangent[0]]
      : [tangent[1], -tangent[0]];
    best = {
      distanceSquared,
      segmentIndex: index,
      ratio,
      point: contactPoint,
      tangent,
      normal,
      signedDistance: delta[0] * normal[0] + delta[1] * normal[1]
    };
  }
  if (!best) return null;
  return Object.freeze({
    segmentIndex: best.segmentIndex,
    ratio: best.ratio,
    point: freezePoint(best.point),
    tangent: freezePoint(best.tangent),
    normal: freezePoint(best.normal),
    signedDistance: best.signedDistance,
    distance: Math.sqrt(best.distanceSquared)
  });
}

export function directedArrowPlacement(path, style = {}, nodeRadius = 0) {
  const points = normalizePoints(path);
  if (points.length < 2) return null;
  const normalized = normalizeInterpolationStyle(style);
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths.at(-1) + distance(points[index - 1], points[index]));
  }
  const total = lengths.at(-1);
  if (total <= EPSILON) return null;
  let target;
  if (normalized.linearArrowMode === 'relative') {
    const fraction = normalized.linearArrowRelativeMode === 'over'
      ? normalized.linearArrowRelativeValue
      : 1 - normalized.linearArrowRelativeValue;
    target = total * clamp(fraction, 0, 1);
  } else {
    const units = normalized.linearArrowAbsoluteValue * Math.max(1, nodeRadius);
    target = normalized.linearArrowAbsoluteMode === 'length'
      ? Math.min(total, units)
      : Math.max(0, total - units);
  }
  for (let index = 1; index < points.length; index += 1) {
    if (lengths[index] + EPSILON < target) continue;
    const segmentLength = lengths[index] - lengths[index - 1];
    const fraction = segmentLength <= EPSILON ? 0 : (target - lengths[index - 1]) / segmentLength;
    const tangent = unit(subtract(points[index], points[index - 1]));
    return Object.freeze({
      position: freezePoint(lerp(points[index - 1], points[index], fraction)),
      tangent: freezePoint(tangent)
    });
  }
  return Object.freeze({
    position: freezePoint(points.at(-1)),
    tangent: freezePoint(unit(subtract(points.at(-1), points.at(-2))))
  });
}

export function coordinateFrameControlGraph(frame, { id = 'coordinate-frame' } = {}) {
  const originId = `${id}:origin`;
  const xId = `${id}:x`;
  const yId = `${id}:y`;
  const origin = [frame[4], frame[5]];
  return Object.freeze({
    vertices: Object.freeze([
      vertex(originId, origin, '#0000ff', false, 'origin'),
      vertex(xId, [origin[0] + frame[0], origin[1] + frame[1]], '#ff0000', true, 'x'),
      vertex(yId, [origin[0] + frame[2], origin[1] + frame[3]], '#00ff00', true, 'y')
    ]),
    edges: Object.freeze([
      axisEdge(`${id}:x-axis`, originId, xId, '#ff0000', 'x'),
      axisEdge(`${id}:y-axis`, originId, yId, '#00ff00', 'y')
    ])
  });
}

export function makeInterpolationEditorBridge() {
  return Object.freeze({
    compute_interpolation(payload = {}) {
      const vertices = Array.isArray(payload.graph?.vertices) ? payload.graph.vertices : [];
      const edges = Array.isArray(payload.graph?.edges) ? payload.graph.edges : [];
      if (vertices.length < 2 || edges.length < 1) return { paths: [] };
      const indices = [Number(edges[0].from)];
      for (const edge of edges) {
        const current = indices.at(-1);
        indices.push(Number(edge.from) === current ? Number(edge.to) : Number(edge.from));
      }
      const points = indices
        .map((index) => vertices[index])
        .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
        .map(({ x, y }) => [x, y]);
      const type = ({
        cubic_spline: 'spline',
        circular_arc: 'radius',
        nurbs: 'spline'
      })[payload.style?.type] || payload.style?.type || 'linear';
      const path = interpolateDirectedPath(points, {
        ...payload.style,
        type,
        tension: payload.style?.tension,
        linearStyle: payload.style?.linear_style
      }, payload.samples_per_segment);
      return {
        paths: [{
          points: path.map(([x, y]) => ({ x, y }))
        }]
      };
    }
  });
}

function vertex(id, position, color, transparent, axis) {
  return Object.freeze({ id, position: freezePoint(position), color, transparent, axis, selectable: true });
}

function axisEdge(id, from, to, color, axis) {
  return Object.freeze({
    id, from, to, color, axis, directed: true, selectable: true,
    interpolationStyle: Object.freeze({ ...DEFAULT_INTERPOLATION_STYLE, linearStyle: 'arrows' })
  });
}

function graphEdges(graph) { return Array.isArray(graph?.hyperedges) ? graph.hyperedges : (graph?.edges || []); }

function vertexPositions(graph) {
  return new Map((graph?.vertices || []).map((vertex) => [vertex.id, vertex.position || vertex.properties?.position]));
}

function resolveStyle(styles, id) {
  if (!id) return null;
  if (Array.isArray(styles)) return styles.find((style) => style.id === id) || null;
  return styles?.[id] || null;
}

function styledEdgeChain(edges, target, styleId) {
  const edgeIds = [target.id];
  const vertexIds = [...target.vertices];
  const used = new Set(edgeIds);
  const extend = (atStart) => {
    while (true) {
      const vertexId = atStart ? vertexIds[0] : vertexIds.at(-1);
      const candidates = edges.filter((edge) => edge.vertices?.length === 2
        && edge.properties?.interpolationStyleId === styleId
        && edge.vertices.includes(vertexId)
        && !used.has(edge.id));
      if (candidates.length !== 1) return;
      const edge = candidates[0];
      const nextVertex = edge.vertices[0] === vertexId ? edge.vertices[1] : edge.vertices[0];
      used.add(edge.id);
      if (atStart) {
        edgeIds.unshift(edge.id);
        vertexIds.unshift(nextVertex);
      } else {
        edgeIds.push(edge.id);
        vertexIds.push(nextVertex);
      }
    }
  };
  extend(true);
  extend(false);
  return { edgeIds, vertexIds };
}

function catmullRom(points, tension, samples) {
  const result = [points[0]];
  const tangentScale = (1 - tension) / 2;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const m1 = scale(subtract(p2, p0), tangentScale);
    const m2 = scale(subtract(p3, p1), tangentScale);
    for (let sample = 1; sample <= samples; sample += 1) {
      const t = sample / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push([
        (2 * t3 - 3 * t2 + 1) * p1[0] + (t3 - 2 * t2 + t) * m1[0]
          + (-2 * t3 + 3 * t2) * p2[0] + (t3 - t2) * m2[0],
        (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1[1]
          + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2[1]
      ]);
    }
  }
  return result;
}

function mixedCornerPoints(points, side = 'left') {
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const next = points[index + 1];
    const incoming = subtract(point, previous);
    const outgoing = subtract(next, point);
    const cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
    const anchor = side === 'right' ? cross <= 0 : cross >= 0;
    if (anchor) result.push(point);
    else result.push(lerp(previous, point, 0.75), lerp(point, next, 0.25));
  }
  result.push(points.at(-1));
  return result;
}

function chaikin(points, iterations) {
  let result = points;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = [result[0]];
    for (let index = 0; index < result.length - 1; index += 1) {
      next.push(lerp(result[index], result[index + 1], 0.25));
      next.push(lerp(result[index], result[index + 1], 0.75));
    }
    next.push(result.at(-1));
    result = next;
  }
  return result;
}

function fractalize(points, iterations) {
  let result = points;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = [result[0]];
    for (let index = 1; index < result.length; index += 1) {
      const from = result[index - 1];
      const to = result[index];
      const middle = lerp(from, to, 0.5);
      const vector = subtract(to, from);
      const sign = (index + iteration) % 2 ? 1 : -1;
      next.push([middle[0] - vector[1] * 0.25 * sign, middle[1] + vector[0] * 0.25 * sign], to);
    }
    result = next;
  }
  return result;
}

function normalizePoints(points) {
  return Array.isArray(points)
    ? points.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .map((point) => [Number(point[0]), Number(point[1])])
    : [];
}

function freezePath(points) { return Object.freeze(points.map(freezePoint)); }
function freezePoint(point) { return Object.freeze([Number(point[0]), Number(point[1])]); }
function lerp(from, to, t) { return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]; }
function subtract(left, right) { return [left[0] - right[0], left[1] - right[1]]; }
function scale(point, factor) { return [point[0] * factor, point[1] * factor]; }
function distance(left, right) { return Math.hypot(left[0] - right[0], left[1] - right[1]); }
function samePoint(left, right) { return distance(left, right) <= EPSILON; }
function signedPathArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twiceArea += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return twiceArea / 2;
}
function contactTangent(points, segmentIndex, ratio, segmentCount, closed) {
  const from = points[segmentIndex];
  const to = points[(segmentIndex + 1) % points.length];
  const current = unit(subtract(to, from));
  if (ratio <= EPSILON && (closed || segmentIndex > 0)) {
    const previousIndex = (segmentIndex - 1 + segmentCount) % segmentCount;
    const previous = unit(subtract(
      points[(previousIndex + 1) % points.length],
      points[previousIndex]
    ));
    return unit([previous[0] + current[0], previous[1] + current[1]]);
  }
  if (ratio >= 1 - EPSILON && (closed || segmentIndex + 1 < segmentCount)) {
    const nextIndex = (segmentIndex + 1) % segmentCount;
    const next = unit(subtract(
      points[(nextIndex + 1) % points.length],
      points[nextIndex]
    ));
    return unit([current[0] + next[0], current[1] + next[1]]);
  }
  return current;
}
function unit(point) { const length = Math.hypot(...point); return length <= EPSILON ? [1, 0] : [point[0] / length, point[1] / length]; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)); }
function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function title(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
