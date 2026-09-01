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

export function packWoodCutSurfacePacketReference(grid, orientation) {
  requireGrid(grid);
  if (!ORIENTATIONS.has(orientation)) {
    throw new RangeError('wood cut orientation must be end-grain or side-grain');
  }
  const imageRgba8 = new Uint8ClampedArray(grid.sampleCount * 4);
  for (let index = 0; index < imageRgba8.length; index += 1) {
    imageRgba8[index] = colorByte(grid.baseColors[index]);
  }
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
  });
}
