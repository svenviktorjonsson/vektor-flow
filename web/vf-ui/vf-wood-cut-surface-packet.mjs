const ORIENTATIONS = new Set(['end-grain', 'side-grain']);

function requireGrid(grid) {
  if (
    !grid
    || grid.kind !== 'wood-cut-plane-grid:v1'
    || !Number.isSafeInteger(grid.rows)
    || !Number.isSafeInteger(grid.columns)
    || !Number.isSafeInteger(grid.sampleCount)
    || grid.rows * grid.columns !== grid.sampleCount
    || !(grid.positions instanceof Float32Array)
    || !(grid.growthCoordinates instanceof Float32Array)
    || !(grid.baseColors instanceof Float32Array)
    || !(grid.surfaceChannels instanceof Float32Array)
    || !Array.isArray(grid.samples)
    || grid.positions.length !== grid.sampleCount * 3
    || grid.growthCoordinates.length !== grid.sampleCount * 3
    || grid.baseColors.length !== grid.sampleCount * 4
    || grid.surfaceChannels.length !== grid.sampleCount * 5
    || grid.samples.length !== grid.sampleCount
  ) {
    throw new TypeError('wood cut plane grid is required');
  }
}

function colorByte(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function gridIndices(rows, columns) {
  const indices = new Uint32Array(Math.max(0, rows - 1) * Math.max(0, columns - 1) * 6);
  let offset = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const topLeft = row * columns + column;
      const bottomLeft = topLeft + columns;
      indices.set([
        topLeft,
        bottomLeft,
        topLeft + 1,
        topLeft + 1,
        bottomLeft,
        bottomLeft + 1,
      ], offset);
      offset += 6;
    }
  }
  return indices;
}

export function packWoodCutSurfacePacketReference(grid, orientation) {
  requireGrid(grid);
  if (!ORIENTATIONS.has(orientation)) {
    throw new RangeError('wood cut orientation must be end-grain or side-grain');
  }
  const imageRgba8 = new Uint8ClampedArray(grid.sampleCount * 4);
  for (let index = 0; index < imageRgba8.length; index += 1) {
    imageRgba8[index] = colorByte(grid.baseColors[index]);
  }
  const indices = gridIndices(grid.rows, grid.columns);
  const primitiveId = grid.samples[0]?.primitiveId ?? 'empty';
  return Object.freeze({
    kind: 'wood-cut-surface-packet:v1',
    id: `wood:cut:${primitiveId}:${orientation}:${grid.columns}x${grid.rows}`,
    orientation,
    sourceGrid: grid,
    imageWidth: grid.columns,
    imageHeight: grid.rows,
    imageRgba8,
    imageBytes: imageRgba8.byteLength,
    positions: grid.positions,
    growthCoordinates: grid.growthCoordinates,
    baseColors: grid.baseColors,
    surfaceChannels: grid.surfaceChannels,
    indices,
    normal: Object.freeze(cross(grid.axisU, grid.axisV)),
    vectorBytes: imageRgba8.byteLength + indices.byteLength,
  });
}
