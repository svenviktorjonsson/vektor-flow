import {
  sampleWoodVolumeReference,
} from './vf-wood-volume-field.mjs';

const MAX_GRID_SAMPLES = 65536;

function requireVector3(value, name) {
  const typed = ArrayBuffer.isView(value) && !(value instanceof DataView);
  if ((!Array.isArray(value) && !typed) || value.length !== 3) {
    throw new TypeError(`${name} must contain exactly three numbers`);
  }
  const vector = Array.from(value);
  vector.forEach((component, index) => {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new RangeError(`${name}[${index}] must be finite`);
    }
  });
  return vector;
}

function requirePositiveFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

function requireDimension(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function normalize(vector, name) {
  const length = Math.hypot(...vector);
  if (!(length > 1e-12)) throw new RangeError(`${name} must be non-zero`);
  return vector.map((component) => component / length);
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function planeAxes(axisUValue, axisVValue) {
  const axisU = normalize(requireVector3(axisUValue, 'wood cut axisU'), 'wood cut axisU');
  const axisVInput = requireVector3(axisVValue, 'wood cut axisV');
  const along = dot(axisVInput, axisU);
  const projected = axisVInput.map((component, index) => component - axisU[index] * along);
  return {
    axisU,
    axisV: normalize(projected, 'wood cut axisV'),
  };
}

function centeredOffset(index, count, extent) {
  if (count === 1) return 0;
  return extent * (index / (count - 1) - 0.5);
}

export function packWoodCutPlaneGridReference({
  field,
  coordinates,
  segmentIndex,
  center: centerValue,
  axisU: axisUValue,
  axisV: axisVValue,
  width,
  height,
  columns,
  rows,
  detailLevel,
  footprint,
  sampleBudget,
}) {
  const center = requireVector3(centerValue, 'wood cut center');
  const { axisU, axisV } = planeAxes(axisUValue, axisVValue);
  requirePositiveFinite(width, 'wood cut width');
  requirePositiveFinite(height, 'wood cut height');
  requireDimension(columns, 'wood cut columns');
  requireDimension(rows, 'wood cut rows');
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_GRID_SAMPLES
  ) {
    throw new RangeError(`wood cut sampleBudget must be an integer from 0 to ${MAX_GRID_SAMPLES}`);
  }
  const sampleCount = rows * columns;
  if (!Number.isSafeInteger(sampleCount) || sampleCount > sampleBudget) {
    throw new RangeError('wood cut plane exceeds sampleBudget');
  }

  const positions = new Float32Array(sampleCount * 3);
  const growthCoordinates = new Float32Array(sampleCount * 3);
  const baseColors = new Float32Array(sampleCount * 4);
  const surfaceChannels = new Float32Array(sampleCount * 5);
  const samples = [];

  for (let row = 0; row < rows; row += 1) {
    const offsetV = centeredOffset(row, rows, height);
    for (let column = 0; column < columns; column += 1) {
      const offsetU = centeredOffset(column, columns, width);
      const index = row * columns + column;
      const point = center.map((value, component) => (
        value + axisU[component] * offsetU + axisV[component] * offsetV
      ));
      const sample = sampleWoodVolumeReference(
        field,
        coordinates,
        segmentIndex,
        point,
        { detailLevel, footprint },
      );
      samples.push(sample);
      positions.set(point, index * 3);
      growthCoordinates.set(sample.growthCoordinates, index * 3);
      baseColors.set(sample.baseColor, index * 4);
      surfaceChannels.set([
        sample.ring,
        sample.ray,
        sample.fiber,
        sample.density,
        sample.roughness,
      ], index * 5);
    }
  }

  return Object.freeze({
    kind: 'wood-cut-plane-grid:v1',
    center: Object.freeze(center),
    axisU: Object.freeze(axisU),
    axisV: Object.freeze(axisV),
    width,
    height,
    detailLevel,
    footprint,
    rows,
    columns,
    sampleCount,
    budget: sampleBudget,
    truncated: false,
    positions,
    growthCoordinates,
    baseColors,
    surfaceChannels,
    samples: Object.freeze(samples),
    vectorBytes: positions.byteLength + growthCoordinates.byteLength
      + baseColors.byteLength + surfaceChannels.byteLength,
  });
}
