import {
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';

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
  const x = position[0] / correlationLength;
  const y = position[1] / correlationLength;
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
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
