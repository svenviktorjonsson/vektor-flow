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
      r: Math.max(1e-9, pointToSegmentDistance(point, segment)),
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

export function evaluateColorFieldRgba(point, field = {}) {
  if (field.kind === 'coordinate-colormap') {
    if (typeof field.worldToLocal !== 'function'
      || typeof field.evaluator !== 'function'
      || typeof field.sampler !== 'function') {
      throw new TypeError('coordinate-colormap requires worldToLocal, evaluator, and sampler');
    }
    const local = field.worldToLocal(point);
    const sampled = field.sampler(clamp01(evaluatedNumber(field.evaluator, {
      x: local?.[0],
      y: local?.[1],
    }, 0)));
    return normalizedRgba(sampled);
  }
  return [...evaluateColorFieldRgb(point, field), 255];
}

export function rasterizeColorField({ width, height, pointAt, field }) {
  const columns = positiveInteger(width, 'width');
  const rows = positiveInteger(height, 'height');
  if (typeof pointAt !== 'function') throw new TypeError('pointAt must be a function');
  const rgba = new Uint8ClampedArray(columns * rows * 4);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const rgbaValue = evaluateColorFieldRgba(pointAt(x, y), field);
      const offset = (y * columns + x) * 4;
      rgba[offset] = rgbaValue[0];
      rgba[offset + 1] = rgbaValue[1];
      rgba[offset + 2] = rgbaValue[2];
      rgba[offset + 3] = rgbaValue[3];
    }
  }
  return rgba;
}

function evaluatedNumber(evaluator, variables, fallback) {
  try {
    const value = Number(evaluator(variables));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function normalizedRgba(value) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return [...FALLBACK_RGB, 255];
  return [0, 1, 2, 3].map((index) => Math.round(Math.min(255, Math.max(0,
    Number(value[index] ?? (index === 3 ? 255 : FALLBACK_RGB[index])) || 0
  ))));
}

export function createCanvasColorFieldRenderer({ canvas, context, screenToWorld }) {
  if (!canvas || !context || typeof screenToWorld !== 'function') {
    throw new TypeError('canvas, context, and screenToWorld are required');
  }
  const rasterCache = new WeakMap();
  return Object.freeze({
    draw({ targetContext, field, screenPoints = [], targetSize = [], maxRasterPixels = Infinity }) {
      if (!targetContext || !screenPoints.length) return false;
      const left = Math.max(0, Math.floor(Math.min(...screenPoints.map(([x]) => x))));
      const top = Math.max(0, Math.floor(Math.min(...screenPoints.map(([, y]) => y))));
      const right = Math.min(targetSize[0] ?? Infinity, Math.ceil(Math.max(...screenPoints.map(([x]) => x))));
      const bottom = Math.min(targetSize[1] ?? Infinity, Math.ceil(Math.max(...screenPoints.map(([, y]) => y))));
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) return false;
      const rasterScale = Number.isFinite(maxRasterPixels) && maxRasterPixels > 0
        ? Math.min(1, Math.sqrt(maxRasterPixels / (width * height)))
        : 1;
      const rasterWidth = Math.max(1, Math.floor(width * rasterScale));
      const rasterHeight = Math.max(1, Math.floor(height * rasterScale));
      const screenStepX = width / rasterWidth;
      const screenStepY = height / rasterHeight;
      canvas.width = rasterWidth;
      canvas.height = rasterHeight;
      const image = context.createImageData(rasterWidth, rasterHeight);
      const origin = screenToWorld([left + screenStepX / 2, top + screenStepY / 2]);
      const xStepPoint = screenToWorld([left + screenStepX * 1.5, top + screenStepY / 2]);
      const yStepPoint = screenToWorld([left + screenStepX / 2, top + screenStepY * 1.5]);
      const xStep = [xStepPoint[0] - origin[0], xStepPoint[1] - origin[1]];
      const yStep = [yStepPoint[0] - origin[0], yStepPoint[1] - origin[1]];
      const signature = [rasterWidth, rasterHeight, ...origin, ...xStep, ...yStep];
      const cached = field && typeof field === 'object' ? rasterCache.get(field) : null;
      const rgba = cached && sameNumbers(cached.signature, signature)
        ? cached.rgba
        : rasterizeColorField({
            width: rasterWidth,
            height: rasterHeight,
            field,
            pointAt: (x, y) => [
              origin[0] + x * xStep[0] + y * yStep[0],
              origin[1] + x * xStep[1] + y * yStep[1],
            ],
          });
      if (field && typeof field === 'object' && rgba !== cached?.rgba) {
        rasterCache.set(field, { signature, rgba });
      }
      image.data.set(rgba);
      context.putImageData(image, 0, 0);
      if (rasterWidth === width && rasterHeight === height) {
        targetContext.drawImage(canvas, left, top);
      } else {
        const priorSmoothing = targetContext.imageSmoothingEnabled;
        const priorQuality = targetContext.imageSmoothingQuality;
        targetContext.imageSmoothingEnabled = true;
        targetContext.imageSmoothingQuality = 'high';
        targetContext.drawImage(canvas, left, top, width, height);
        targetContext.imageSmoothingEnabled = priorSmoothing;
        targetContext.imageSmoothingQuality = priorQuality;
      }
      return true;
    },
  });
}

function sameNumbers(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
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
