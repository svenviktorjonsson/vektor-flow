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

function sampleDerivative(channels, rows, columns, row, column, axis) {
  const before = axis === 'u'
    ? Math.max(0, column - 1)
    : Math.max(0, row - 1);
  const after = axis === 'u'
    ? Math.min(columns - 1, column + 1)
    : Math.min(rows - 1, row + 1);
  if (before === after) return 0;
  const firstIndex = axis === 'u'
    ? row * columns + before
    : before * columns + column;
  const lastIndex = axis === 'u'
    ? row * columns + after
    : after * columns + column;
  const normalizedSteps = axis === 'u' ? columns - 1 : rows - 1;
  return (
    (materialHeight(channels, lastIndex) - materialHeight(channels, firstIndex))
    * normalizedSteps
    / (after - before)
  );
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
      );
      const slopeV = sampleDerivative(
        surface.surfaceChannels,
        rows,
        columns,
        row,
        column,
        'v',
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
    normalRgba8,
    roughnessR8,
    vectorBytes: normalRgba8.byteLength + roughnessR8.byteLength,
  });
  materialCache.set(surface, packet);
  return packet;
}
