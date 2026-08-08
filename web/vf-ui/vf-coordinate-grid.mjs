export const AXIS_DISPLAY_MODES = Object.freeze(['none', 'regular', 'complex']);
export const GRID_DISPLAY_MODES = Object.freeze(['lines', 'points', 'triangular', 'polar', 'none']);

const MAX_PRIMITIVES = 500;
const TAU = Math.PI * 2;

export function buildCoordinateGridScene(spec = {}) {
  const width = positive(spec.width, 1);
  const height = positive(spec.height, 1);
  const worldToScreen = requiredTransform(spec.worldToScreen, 'worldToScreen');
  const screenToWorld = requiredTransform(spec.screenToWorld, 'screenToWorld');
  const gridMode = GRID_DISPLAY_MODES.includes(spec.gridMode) ? spec.gridMode : 'lines';
  const axisMode = AXIS_DISPLAY_MODES.includes(spec.axisMode) ? spec.axisMode : 'none';
  const xInterval = positive(spec.xInterval, positive(spec.interval, 1));
  const yInterval = positive(spec.yInterval, xInterval);
  const tickLength = positive(spec.tickLength, 6);
  const bounds = visibleBounds(width, height, screenToWorld);
  const xValues = multiples(bounds.x[0], bounds.x[1], xInterval);
  const yValues = multiples(bounds.y[0], bounds.y[1], yInterval);
  const lines = [];
  const points = [];
  const circles = [];

  if (gridMode === 'lines') {
    for (const x of xValues) lines.push(line(worldToScreen([x, bounds.y[0]]), worldToScreen([x, bounds.y[1]]), 'grid'));
    for (const y of yValues) lines.push(line(worldToScreen([bounds.x[0], y]), worldToScreen([bounds.x[1], y]), 'grid'));
  } else if (gridMode === 'points') {
    for (const x of xValues) for (const y of yValues) {
      if (points.length >= MAX_PRIMITIVES) break;
      points.push(Object.freeze({ at: freezePoint(worldToScreen([x, y])), kind: 'grid-point' }));
    }
  } else if (gridMode === 'triangular') {
    appendTriangularGrid(points, bounds, xInterval, worldToScreen);
  } else if (gridMode === 'polar') {
    appendPolarGrid(lines, circles, bounds, xInterval, worldToScreen);
  }

  const axes = axisMode === 'none' ? [] : [
    line(worldToScreen([bounds.x[0], 0]), worldToScreen([bounds.x[1], 0]), 'axis-x'),
    line(worldToScreen([0, bounds.y[0]]), worldToScreen([0, bounds.y[1]]), 'axis-y')
  ];
  const ticks = axisMode === 'none' ? [] : axisTicks({
    xValues, yValues, xInterval, yInterval, tickLength, worldToScreen
  });
  const labels = axisMode === 'none' ? [] : tickLabels({
    bounds, xValues, yValues, xInterval, yInterval, worldToScreen, width, height
  });
  const axisLabels = axisMode === 'none' ? [] : [
    Object.freeze({
      latex: axisMode === 'complex' ? '\\operatorname{Re}' : 'x',
      axis: 'axis-x',
      at: freezePoint(worldToScreen([bounds.x[1], 0]))
    }),
    Object.freeze({
      latex: axisMode === 'complex' ? '\\operatorname{Im}' : 'y',
      axis: 'axis-y',
      at: freezePoint(worldToScreen([0, bounds.y[1]]))
    })
  ];

  return Object.freeze({
    mode: gridMode,
    axisMode,
    lines: Object.freeze(lines),
    points: Object.freeze(points),
    circles: Object.freeze(circles),
    axes: Object.freeze(axes),
    ticks: Object.freeze(ticks),
    labels: Object.freeze(labels),
    axisLabels: Object.freeze(axisLabels)
  });
}

export function buildCoordinateCrosshair3dScene(spec = {}) {
  const width = positive(spec.width, 1);
  const height = positive(spec.height, 1);
  const worldToScreen = requiredTransform(spec.worldToScreen, 'worldToScreen');
  const interval = positive(spec.interval, 1);
  const tickLength = positive(spec.tickLength, 6);
  const originWorld = freezeWorldPoint(spec.origin || [0, 0, 0]);
  const origin = freezePoint(worldToScreen(originWorld));
  const axes = [];
  const ticks = [];
  const labels = [];
  const axisLabels = [];
  const names = ['x', 'y', 'z'];

  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const unitWorld = [...originWorld];
    unitWorld[axisIndex] += 1;
    const unitScreen = freezePoint(worldToScreen(unitWorld));
    const direction = subtract(unitScreen, origin);
    const pixelsPerUnit = Math.hypot(...direction);
    if (!(pixelsPerUnit > 1e-9)) continue;
    const clipped = clipInfiniteLineToRect(origin, direction, width, height);
    if (!clipped) continue;
    const axis = names[axisIndex];
    axes.push(Object.freeze({
      from: freezePoint(clipped.from),
      to: freezePoint(clipped.to),
      axis,
      kind: `axis-${axis}`
    }));
    const normal = unit([-direction[1], direction[0]]);
    const halfTick = tickLength / 2;
    const minimum = Math.min(clipped.fromParameter, clipped.toParameter);
    const maximum = Math.max(clipped.fromParameter, clipped.toParameter);
    for (const value of multiples(minimum, maximum, interval)) {
      if (nearZero(value, interval)) continue;
      const at = offset(origin, direction, value);
      ticks.push(line(
        offset(at, normal, -halfTick),
        offset(at, normal, halfTick),
        `axis-tick-${axis}`
      ));
      if (inside(at, width, height)) labels.push(label(value, interval, axis, at));
    }
    axisLabels.push(Object.freeze({
      latex: axis,
      axis: `axis-${axis}`,
      at: freezePoint(clipped.toParameter >= clipped.fromParameter ? clipped.to : clipped.from)
    }));
  }

  if (inside(origin, width, height)) {
    labels.push(Object.freeze({ latex: '0', value: 0, axis: 'origin', at: origin }));
  }
  return Object.freeze({
    axisMode: axes.length ? 'regular' : 'none',
    axes: Object.freeze(axes),
    ticks: Object.freeze(ticks),
    labels: Object.freeze(labels),
    axisLabels: Object.freeze(axisLabels)
  });
}

function axisTicks({ xValues, yValues, xInterval, yInterval, tickLength, worldToScreen }) {
  const ticks = [];
  const origin = worldToScreen([0, 0]);
  const xNormal = unit(subtract(worldToScreen([0, 1]), origin));
  const yNormal = unit(subtract(worldToScreen([1, 0]), origin));
  const half = tickLength / 2;
  for (const value of xValues) {
    if (nearZero(value, xInterval)) continue;
    const at = worldToScreen([value, 0]);
    ticks.push(line(offset(at, xNormal, -half), offset(at, xNormal, half), 'axis-tick-x'));
  }
  for (const value of yValues) {
    if (nearZero(value, yInterval)) continue;
    const at = worldToScreen([0, value]);
    ticks.push(line(offset(at, yNormal, -half), offset(at, yNormal, half), 'axis-tick-y'));
  }
  return ticks;
}

function appendTriangularGrid(points, bounds, interval, worldToScreen) {
  const dy = interval * Math.sqrt(3) / 2;
  const firstRow = Math.ceil(bounds.y[0] / dy);
  const lastRow = Math.floor(bounds.y[1] / dy);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const y = row * dy;
    const shift = Math.abs(row % 2) * interval / 2;
    const firstColumn = Math.ceil((bounds.x[0] - shift) / interval);
    const lastColumn = Math.floor((bounds.x[1] - shift) / interval);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (points.length >= MAX_PRIMITIVES) return;
      points.push(Object.freeze({
        at: freezePoint(worldToScreen([column * interval + shift, y])),
        kind: 'triangular-point'
      }));
    }
  }
}

function appendPolarGrid(lines, circles, bounds, interval, worldToScreen) {
  const radius = Math.max(...[
    [bounds.x[0], bounds.y[0]], [bounds.x[1], bounds.y[0]],
    [bounds.x[1], bounds.y[1]], [bounds.x[0], bounds.y[1]]
  ].map(([x, y]) => Math.hypot(x, y)));
  const center = freezePoint(worldToScreen([0, 0]));
  const radiusScale = Math.hypot(...subtract(worldToScreen([1, 0]), center));
  for (let r = interval; r <= radius; r += interval) {
    if (circles.length >= MAX_PRIMITIVES) break;
    circles.push(Object.freeze({ center, radius: r * radiusScale, kind: 'polar-circle' }));
  }
  for (let angle = 0; angle < TAU; angle += Math.PI / 12) {
    lines.push(line(center, worldToScreen([Math.cos(angle) * radius, Math.sin(angle) * radius]), 'polar-ray'));
  }
}

function tickLabels({ bounds, xValues, yValues, xInterval, yInterval, worldToScreen, width, height }) {
  const labels = [];
  for (const value of xValues) {
    if (nearZero(value, xInterval)) continue;
    const at = worldToScreen([value, 0]);
    if (inside(at, width, height)) labels.push(label(value, xInterval, 'x', at));
  }
  for (const value of yValues) {
    if (nearZero(value, yInterval)) continue;
    const at = worldToScreen([0, value]);
    if (inside(at, width, height)) labels.push(label(value, yInterval, 'y', at));
  }
  const origin = worldToScreen([0, 0]);
  if (inside(origin, width, height)) labels.push(Object.freeze({ latex: '0', value: 0, axis: 'origin', at: freezePoint(origin) }));
  return labels;
}

function label(value, interval, axis, at) {
  const raw = formatAxisTickLabel(value, interval);
  return Object.freeze({ latex: stripMathDelimiters(raw), value, axis, at: freezePoint(at) });
}

function formatAxisTickLabel(value, step) {
  let normalized = Number(value) || 0;
  const decimals = decimalPlacesForStep(step);
  if (decimals != null) normalized = Math.round(normalized / step) * step;
  if (Math.abs(normalized) < 1e-12) normalized = 0;
  const absolute = Math.abs(normalized);
  if (absolute !== 0 && (absolute < 0.01 || absolute >= 1e4)) {
    return `$${formatScientificBody(normalized)}$`;
  }
  if (decimals != null) {
    if (decimals === 0 || Math.abs(normalized - Math.round(normalized)) < 1e-12) {
      return String(Math.round(normalized)).replace(/^-/, '−');
    }
    return Number(normalized.toFixed(decimals)).toFixed(decimals)
      .replace(/\.?0+$/, '')
      .replace(/^-/, '−');
  }
  return String(Number(normalized.toPrecision(6))).replace(/^-/, '−');
}

function decimalPlacesForStep(step) {
  const normalized = Math.abs(Number(step));
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  for (let decimals = 0; decimals <= 12; decimals += 1) {
    if (Math.abs(normalized * 10 ** decimals - Math.round(normalized * 10 ** decimals)) < 1e-9) {
      return decimals;
    }
  }
  return null;
}

function formatScientificBody(value) {
  const normalized = Number(value) || 0;
  if (normalized === 0) return '0';
  const sign = normalized < 0 ? '-' : '';
  const exponent = Math.floor(Math.log10(Math.abs(normalized)));
  const mantissa = Number((Math.abs(normalized) / 10 ** exponent).toPrecision(6));
  return Math.abs(mantissa - 1) < 1e-8
    ? `${sign}10^{${exponent}}`
    : `${sign}${mantissa} \\cdot 10^{${exponent}}`;
}

function stripMathDelimiters(value) {
  const text = String(value ?? '');
  return text.startsWith('$') && text.endsWith('$') ? text.slice(1, -1) : text;
}

function visibleBounds(width, height, screenToWorld) {
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(screenToWorld);
  return Object.freeze({
    x: Object.freeze([Math.min(...corners.map(([x]) => x)), Math.max(...corners.map(([x]) => x))]),
    y: Object.freeze([Math.min(...corners.map(([, y]) => y)), Math.max(...corners.map(([, y]) => y))])
  });
}

function clipInfiniteLineToRect(origin, direction, width, height) {
  const candidates = [];
  const append = (parameter, x, y) => {
    if (!Number.isFinite(parameter) || x < -1e-9 || x > width + 1e-9 || y < -1e-9 || y > height + 1e-9) return;
    if (candidates.some(({ point }) => Math.hypot(point[0] - x, point[1] - y) < 1e-8)) return;
    candidates.push({ parameter, point: [clampEdge(x, width), clampEdge(y, height)] });
  };
  if (Math.abs(direction[0]) > 1e-12) {
    for (const x of [0, width]) {
      const parameter = (x - origin[0]) / direction[0];
      append(parameter, x, origin[1] + parameter * direction[1]);
    }
  }
  if (Math.abs(direction[1]) > 1e-12) {
    for (const y of [0, height]) {
      const parameter = (y - origin[1]) / direction[1];
      append(parameter, origin[0] + parameter * direction[0], y);
    }
  }
  if (candidates.length < 2) return null;
  candidates.sort((left, right) => left.parameter - right.parameter);
  const from = candidates[0];
  const to = candidates.at(-1);
  return {
    from: from.point,
    to: to.point,
    fromParameter: from.parameter,
    toParameter: to.parameter
  };
}

function multiples(minimum, maximum, interval) {
  const values = [];
  const start = Math.ceil(minimum / interval) * interval;
  for (let value = start; value <= maximum + interval * 1e-9 && values.length < MAX_PRIMITIVES; value += interval) {
    values.push(Number(value.toPrecision(12)));
  }
  return values;
}

function line(from, to, kind) {
  return Object.freeze({ from: freezePoint(from), to: freezePoint(to), kind });
}

function freezePoint(point) { return Object.freeze([Number(point[0]), Number(point[1])]); }
function freezeWorldPoint(point) {
  return Object.freeze([0, 1, 2].map((index) => Number(point?.[index]) || 0));
}
function clampEdge(value, maximum) {
  if (Math.abs(value) < 1e-9) return 0;
  if (Math.abs(value - maximum) < 1e-9) return maximum;
  return value;
}
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function unit(vector) {
  const length = Math.hypot(...vector);
  return length > 0 ? [vector[0] / length, vector[1] / length] : [1, 0];
}
function offset(point, direction, distance) {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance];
}
function nearZero(value, interval) { return Math.abs(value) <= interval * 1e-9; }
function inside([x, y], width, height) { return x >= 0 && x <= width && y >= 0 && y <= height; }
function positive(value, fallback) { return Number.isFinite(value) && value > 0 ? value : fallback; }
function requiredTransform(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function.`);
  return value;
}
