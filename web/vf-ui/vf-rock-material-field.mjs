import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_OCTAVES = 6;
const DERIVATIVE_STEP = 1e-4;
const DARK_COLOR = Object.freeze([0.22, 0.19, 0.15]);
const WEATHERED_COLOR = Object.freeze([0.55, 0.49, 0.4]);

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function requireSurfaceCoordinates(value) {
  const isTypedArray = ArrayBuffer.isView(value) && !(value instanceof DataView);
  if ((!Array.isArray(value) && !isTypedArray) || value.length !== 2) {
    throw new TypeError('rock surface coordinates must contain exactly two numbers');
  }
  for (let axis = 0; axis < 2; axis += 1) {
    if (typeof value[axis] !== 'number') {
      throw new TypeError(`rock surface coordinate[${axis}] must be a number`);
    }
    if (!Number.isFinite(value[axis])) {
      throw new RangeError(`rock surface coordinate[${axis}] must be finite`);
    }
  }
}

function requireOptions({ detailLevel, footprint }) {
  if (!Number.isSafeInteger(detailLevel) || detailLevel < 0) {
    throw new RangeError('rock material detailLevel must be a non-negative safe integer');
  }
  if (typeof footprint !== 'number') {
    throw new TypeError('rock material footprint must be a number');
  }
  if (!Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('rock material footprint must be finite and non-negative');
  }
}

function filterWeight(wavelength, footprint) {
  if (footprint <= wavelength * 0.5) return 1;
  if (footprint >= wavelength) return 0;
  const ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3 - 2 * ratio);
}

function rawGeology(node, surfaceCoordinates, detailLevel, footprint) {
  const octaveCount = Math.min(MAX_OCTAVES, detailLevel + 2);
  let weighted = 0;
  let totalWeight = 0;
  for (let octave = 0; octave < octaveCount; octave += 1) {
    const wavelength = 2 ** -octave;
    const weight = (0.56 ** octave) * filterWeight(wavelength, footprint);
    if (!(weight > 0)) continue;
    weighted += weight * sampleSpatialCorrelation2Reference(
      node,
      surfaceCoordinates,
      { correlationLength: wavelength, mean: 0, amplitude: 1 },
    );
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

function normalizedTangentNormal(derivativeU, derivativeV) {
  const x = -derivativeU * 0.18;
  const y = -derivativeV * 0.18;
  const length = Math.hypot(x, y, 1);
  return Object.freeze([x / length, y / length, 1 / length]);
}

export function createRockMaterialFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const node = conditionChild(root, {
    segment: 'rock:geology-weathering:v1',
    channel: 'shared-surface-field',
  });
  const field = Object.freeze({
    kind: 'rock-geology-weathering:v1',
    identity: root,
    maxOctaves: MAX_OCTAVES,
  });
  fieldState.set(field, { node });
  return field;
}

export function sampleRockMaterialReference(
  field,
  surfaceCoordinates,
  { detailLevel, footprint },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('rock material field is required');
  }
  requireSurfaceCoordinates(surfaceCoordinates);
  requireOptions({ detailLevel, footprint });
  const geology = rawGeology(
    state.node,
    surfaceCoordinates,
    detailLevel,
    footprint,
  );
  const at = (offsetU, offsetV) => rawGeology(
    state.node,
    [surfaceCoordinates[0] + offsetU, surfaceCoordinates[1] + offsetV],
    detailLevel,
    footprint,
  );
  const derivativeU = (
    at(DERIVATIVE_STEP, 0) - at(-DERIVATIVE_STEP, 0)
  ) / (2 * DERIVATIVE_STEP);
  const derivativeV = (
    at(0, DERIVATIVE_STEP) - at(0, -DERIVATIVE_STEP)
  ) / (2 * DERIVATIVE_STEP);
  const weathering = clampUnit(0.5 + 0.5 * geology);
  const baseColor = Object.freeze([
    DARK_COLOR[0] + (WEATHERED_COLOR[0] - DARK_COLOR[0]) * weathering,
    DARK_COLOR[1] + (WEATHERED_COLOR[1] - DARK_COLOR[1]) * weathering,
    DARK_COLOR[2] + (WEATHERED_COLOR[2] - DARK_COLOR[2]) * weathering,
    1,
  ]);
  return Object.freeze({
    geology,
    weathering,
    baseColor,
    roughness: 0.92 - 0.34 * weathering,
    displacement: 0.08 * geology,
    derivative: Object.freeze([derivativeU, derivativeV]),
    tangentNormal: normalizedTangentNormal(derivativeU, derivativeV),
  });
}
