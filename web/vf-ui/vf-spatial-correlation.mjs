import {
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';

const MIN_LATTICE_CELL = -0x80000000;
const MAX_LATTICE_CELL = 0x7ffffffe;

function requireFinitePosition2(position) {
  const isTypedArray = ArrayBuffer.isView(position) && !(position instanceof DataView);
  if ((!Array.isArray(position) && !isTypedArray) || position.length !== 2) {
    throw new TypeError('spatial correlation position must contain exactly two numbers');
  }
  for (let index = 0; index < 2; index += 1) {
    if (typeof position[index] !== 'number') {
      throw new TypeError(`spatial correlation position[${index}] must be a number`);
    }
    if (!Number.isFinite(position[index])) {
      throw new RangeError(`spatial correlation position[${index}] must be finite`);
    }
  }
}

function requireFiniteScalar(value, name, { positive = false, nonNegative = false } = {}) {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`);
  }
  if (
    !Number.isFinite(value)
    || (positive && !(value > 0))
    || (nonNegative && value < 0)
  ) {
    const constraint = positive ? 'finite and positive' : (
      nonNegative ? 'finite and non-negative' : 'finite'
    );
    throw new RangeError(`${name} must be ${constraint}`);
  }
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function interpolate(first, second, weight) {
  return first + (second - first) * weight;
}

export function sampleSpatialCorrelation2Reference(
  node,
  position,
  { correlationLength, mean, amplitude },
) {
  requireFinitePosition2(position);
  requireFiniteScalar(correlationLength, 'spatial correlation length', { positive: true });
  requireFiniteScalar(mean, 'spatial correlation mean');
  requireFiniteScalar(amplitude, 'spatial correlation amplitude', { nonNegative: true });
  const x = position[0] / correlationLength;
  const y = position[1] / correlationLength;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError('normalized spatial correlation position must be finite');
  }
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  if (
    cellX < MIN_LATTICE_CELL
    || cellX > MAX_LATTICE_CELL
    || cellY < MIN_LATTICE_CELL
    || cellY > MAX_LATTICE_CELL
  ) {
    throw new RangeError('spatial correlation position exceeds the bounded lattice domain');
  }
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const corner = (offsetX, offsetY) => sampleBoundedUniform(
    node,
    [(cellX + offsetX) >>> 0, (cellY + offsetY) >>> 0],
    { min: -1, max: 1 },
  );
  const lower = interpolate(corner(0, 0), corner(1, 0), fade(fractionX));
  const upper = interpolate(corner(0, 1), corner(1, 1), fade(fractionX));
  return mean + amplitude * interpolate(lower, upper, fade(fractionY));
}
