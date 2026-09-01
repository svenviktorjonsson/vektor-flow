const materialCache = new WeakMap();
const NORMAL_STRENGTH = 0.22;

function requireSurface(surface) {
  const grid = surface?.sourceGrid;
  if (
    !surface
    || surface.kind !== 'wood-cut-surface-packet:v1'
    || !grid
    || grid.kind !== 'wood-cut-plane-grid:v1'
    || !Number.isSafeInteger(surface.imageWidth)
    || !Number.isSafeInteger(surface.imageHeight)
    || surface.imageWidth * surface.imageHeight !== grid.sampleCount
    || !(surface.positions instanceof Float32Array)
    || !(surface.growthCoordinates instanceof Float32Array)
    || !(surface.surfaceChannels instanceof Float32Array)
    || surface.surfaceChannels.length !== grid.sampleCount * 5
  ) {
    throw new TypeError('wood cut surface packet is required');
  }
  return grid;
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function unitByte(value) {
  return Math.round(clampUnit(value) * 255);
}

function materialHeight(channels, sampleIndex) {
  const offset = sampleIndex * 5;
  const ring = channels[offset];
  const ray = channels[offset + 1];
  const fiber = channels[offset + 2];
  const density = channels[offset + 3];
  return 0.25 * ring + 0.12 * ray + 0.08 * fiber + 0.55 * density;
}

function filterRadius(footprint, extent, count) {
  if (!(footprint > 0) || count <= 1) return 0;
  const sampleSpacing = extent / (count - 1);
  return Math.min(count - 1, Math.floor(footprint / (2 * sampleSpacing)));
}

function heightIntegral(channels, rows, columns) {
  const stride = columns + 1;
  const integral = new Float64Array((rows + 1) * stride);
  for (let row = 0; row < rows; row += 1) {
    let rowSum = 0;
    for (let column = 0; column < columns; column += 1) {
      rowSum += materialHeight(channels, row * columns + column);
      integral[(row + 1) * stride + column + 1] = integral[row * stride + column + 1] + rowSum;
    }
  }
  return integral;
}

function filteredHeight(
  channels,
  integral,
  rows,
  columns,
  row,
  column,
  radiusU,
  radiusV,
) {
  if (radiusU === 0 && radiusV === 0) {
    return materialHeight(channels, row * columns + column);
  }
  const left = Math.max(0, column - radiusU);
  const right = Math.min(columns - 1, column + radiusU);
  const top = Math.max(0, row - radiusV);
  const bottom = Math.min(rows - 1, row + radiusV);
  const stride = columns + 1;
  const sum = integral[(bottom + 1) * stride + right + 1]
    - integral[top * stride + right + 1]
    - integral[(bottom + 1) * stride + left]
    + integral[top * stride + left];
  return sum / ((right - left + 1) * (bottom - top + 1));
}

function sampleDerivative(
  channels,
  rows,
  columns,
  row,
  column,
  axis,
  integral,
  radiusU,
  radiusV,
) {
  const step = Math.max(1, axis === 'u' ? radiusU : radiusV);
  const before = axis === 'u'
    ? Math.max(0, column - step)
    : Math.max(0, row - step);
  const after = axis === 'u'
    ? Math.min(columns - 1, column + step)
    : Math.min(rows - 1, row + step);
  if (before === after) return 0;
  const firstHeight = axis === 'u'
    ? filteredHeight(channels, integral, rows, columns, row, before, radiusU, radiusV)
    : filteredHeight(channels, integral, rows, columns, before, column, radiusU, radiusV);
  const lastHeight = axis === 'u'
    ? filteredHeight(channels, integral, rows, columns, row, after, radiusU, radiusV)
    : filteredHeight(channels, integral, rows, columns, after, column, radiusU, radiusV);
  const normalizedSteps = axis === 'u' ? columns - 1 : rows - 1;
  const derivative = (
    (lastHeight - firstHeight)
    * normalizedSteps
    / (after - before)
  );
  return Math.abs(derivative) < 1e-12 ? 0 : derivative;
}

function encodeNormal(target, pixel, x, y, z) {
  const length = Math.hypot(x, y, z);
  const offset = pixel * 4;
  target[offset] = unitByte(0.5 + 0.5 * x / length);
  target[offset + 1] = unitByte(0.5 + 0.5 * y / length);
  target[offset + 2] = unitByte(0.5 + 0.5 * z / length);
  target[offset + 3] = 255;
}

export function packWoodCutMaterialPacketReference(surface) {
  const grid = requireSurface(surface);
  const retained = materialCache.get(surface);
  if (retained) return retained;

  const rows = surface.imageHeight;
  const columns = surface.imageWidth;
  const normalFilterRadius = Object.freeze([
    filterRadius(grid.footprint, grid.width, columns),
    filterRadius(grid.footprint, grid.height, rows),
  ]);
  const integral = normalFilterRadius[0] === 0 && normalFilterRadius[1] === 0
    ? null
    : heightIntegral(surface.surfaceChannels, rows, columns);
  const normalRgba8 = new Uint8ClampedArray(grid.sampleCount * 4);
  const roughnessR8 = new Uint8Array(grid.sampleCount);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pixel = row * columns + column;
      const slopeU = sampleDerivative(
        surface.surfaceChannels,
        rows,
        columns,
        row,
        column,
        'u',
        integral,
        normalFilterRadius[0],
        normalFilterRadius[1],
      );
      const slopeV = sampleDerivative(
        surface.surfaceChannels,
        rows,
        columns,
        row,
        column,
        'v',
        integral,
        normalFilterRadius[0],
        normalFilterRadius[1],
      );
      encodeNormal(
        normalRgba8,
        pixel,
        -NORMAL_STRENGTH * slopeU,
        -NORMAL_STRENGTH * slopeV,
        1,
      );
      roughnessR8[pixel] = unitByte(surface.surfaceChannels[pixel * 5 + 4]);
    }
  }

  const packet = Object.freeze({
    kind: 'wood-cut-material-packet:v1',
    id: `${surface.id}:material`,
    orientation: surface.orientation,
    sourceSurface: surface,
    positions: surface.positions,
    growthCoordinates: surface.growthCoordinates,
    baseColors: surface.baseColors,
    surfaceChannels: surface.surfaceChannels,
    imageWidth: columns,
    imageHeight: rows,
    normalFilterRadius,
    normalRgba8,
    roughnessR8,
    vectorBytes: normalRgba8.byteLength + roughnessR8.byteLength,
  });
  materialCache.set(surface, packet);
  return packet;
}
