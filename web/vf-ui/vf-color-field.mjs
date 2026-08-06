const FALLBACK_RGB = Object.freeze([128, 128, 128]);
const SOURCE_EPSILON = 1e-12;

export function pointSourceRgb(point, sourcePoints, colors, weightEvaluator) {
  const channels = colors.map(parseCssRgb);
  const exactSource = sourcePoints.findIndex((source) =>
    distance(point, source) <= SOURCE_EPSILON
  );
  if (exactSource >= 0) return [...(channels[exactSource] || FALLBACK_RGB)];
  return normalizedWeightedRgb(
    sourcePoints.map(([x, y]) => positiveWeight(weightEvaluator, {
      x: point[0] - x,
      y: point[1] - y,
    })),
    channels,
  );
}

export function segmentSourceRgb(point, segments, colors, weightEvaluator) {
  return normalizedWeightedRgb(
    segments.map((segment) => positiveWeight(weightEvaluator, {
      x: Math.max(1e-9, pointToSegmentDistance(point, segment)),
      y: 0,
    })),
    colors.map(parseCssRgb),
  );
}

export function evaluateColorFieldRgb(point, field = {}) {
  if (field.kind === 'point-distance') {
    return pointSourceRgb(point, field.points || [], field.colors || [], field.weightEvaluator);
  }
  if (field.kind === 'edge-distance' || field.kind === 'segment-distance') {
    return segmentSourceRgb(point, field.segments || [], field.colors || [], field.weightEvaluator);
  }
  throw new TypeError(`Unsupported color field kind: ${String(field.kind)}`);
}

export function rasterizeColorField({ width, height, pointAt, field }) {
  const columns = positiveInteger(width, 'width');
  const rows = positiveInteger(height, 'height');
  if (typeof pointAt !== 'function') throw new TypeError('pointAt must be a function');
  const rgba = new Uint8ClampedArray(columns * rows * 4);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const rgb = evaluateColorFieldRgb(pointAt(x, y), field);
      const offset = (y * columns + x) * 4;
      rgba[offset] = rgb[0];
      rgba[offset + 1] = rgb[1];
      rgba[offset + 2] = rgb[2];
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

export function createCanvasColorFieldRenderer({ canvas, context, screenToWorld }) {
  if (!canvas || !context || typeof screenToWorld !== 'function') {
    throw new TypeError('canvas, context, and screenToWorld are required');
  }
  return Object.freeze({
    draw({ targetContext, field, screenPoints = [], targetSize = [] }) {
      if (!targetContext || !screenPoints.length) return false;
      const left = Math.max(0, Math.floor(Math.min(...screenPoints.map(([x]) => x))));
      const top = Math.max(0, Math.floor(Math.min(...screenPoints.map(([, y]) => y))));
      const right = Math.min(targetSize[0] ?? Infinity, Math.ceil(Math.max(...screenPoints.map(([x]) => x))));
      const bottom = Math.min(targetSize[1] ?? Infinity, Math.ceil(Math.max(...screenPoints.map(([, y]) => y))));
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return false;
      canvas.width = width;
      canvas.height = height;
      const image = context.createImageData(width, height);
      const origin = screenToWorld([left + 0.5, top + 0.5]);
      const xStepPoint = screenToWorld([left + 1.5, top + 0.5]);
      const yStepPoint = screenToWorld([left + 0.5, top + 1.5]);
      const xStep = [xStepPoint[0] - origin[0], xStepPoint[1] - origin[1]];
      const yStep = [yStepPoint[0] - origin[0], yStepPoint[1] - origin[1]];
      image.data.set(rasterizeColorField({
        width,
        height,
        field,
        pointAt: (x, y) => [
          origin[0] + x * xStep[0] + y * yStep[0],
          origin[1] + x * xStep[1] + y * yStep[1],
        ],
      }));
      context.putImageData(image, 0, 0);
      targetContext.drawImage(canvas, left, top);
      return true;
    },
  });
}

function normalizedWeightedRgb(weights, colors) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return [...(colors[0] || FALLBACK_RGB)];
  return [0, 1, 2].map((channel) => Math.round(colors.reduce(
    (sum, color, index) => sum + (color?.[channel] ?? FALLBACK_RGB[channel]) * weights[index],
    0,
  ) / total));
}

function positiveWeight(evaluator, variables) {
  if (typeof evaluator !== 'function') return 0;
  try {
    const value = Number(evaluator(variables));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function pointToSegmentDistance(point, [from, to]) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared <= Number.EPSILON
    ? 0
    : Math.max(0, Math.min(1, (
        (point[0] - from[0]) * dx + (point[1] - from[1]) * dy
      ) / lengthSquared));
  return distance(point, [from[0] + dx * projection, from[1] + dy * projection]);
}

function parseCssRgb(value) {
  const source = String(value || '').trim();
  const shortHex = source.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) return [...shortHex[1]].map((digit) => parseInt(digit + digit, 16));
  const hex = source.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 1, 2].map((index) => parseInt(hex[1].slice(index * 2, index * 2 + 2), 16));
  const rgb = source.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
  return rgb ? rgb.slice(1, 4).map(Number) : [...FALLBACK_RGB];
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive integer`);
  return number;
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}
