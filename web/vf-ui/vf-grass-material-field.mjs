import {
  conditionChild,
  createConditionedRoot,
} from './vf-conditioned-distribution.mjs';
import {
  sampleSpatialCorrelation2Reference,
} from './vf-spatial-correlation.mjs';

const fieldState = new WeakMap();
const MAX_OCTAVES = 6;
const DRY_COLOR = Object.freeze([0.24, 0.31, 0.08]);
const LUSH_COLOR = Object.freeze([0.16, 0.48, 0.09]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function requirePosition(position) {
  const typed = ArrayBuffer.isView(position) && !(position instanceof DataView);
  if ((!Array.isArray(position) && !typed) || position.length !== 2) {
    throw new TypeError('grass field position must contain exactly two numbers');
  }
  for (let axis = 0; axis < 2; axis += 1) {
    if (typeof position[axis] !== 'number') {
      throw new TypeError(`grass field position[${axis}] must be a number`);
    }
    if (!Number.isFinite(position[axis])) {
      throw new RangeError(`grass field position[${axis}] must be finite`);
    }
  }
}

function requireOptions({ detailLevel, footprint }) {
  if (!Number.isSafeInteger(detailLevel) || detailLevel < 0) {
    throw new RangeError('grass material detailLevel must be a non-negative safe integer');
  }
  if (typeof footprint !== 'number') {
    throw new TypeError('grass material footprint must be a number');
  }
  if (!Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('grass material footprint must be finite and non-negative');
  }
}

function filterWeight(wavelength, footprint) {
  if (footprint <= wavelength * 0.5) return 1;
  if (footprint >= wavelength) return 0;
  const ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3 - 2 * ratio);
}

function sampleDetail(node, position, detailLevel, footprint) {
  const octaveCount = Math.min(MAX_OCTAVES, detailLevel + 1);
  let weighted = 0;
  let totalWeight = 0;
  for (let octave = 0; octave < octaveCount; octave += 1) {
    const wavelength = 1.5 * (2 ** -octave);
    const weight = (0.52 ** octave) * filterWeight(wavelength, footprint);
    if (!(weight > 0)) continue;
    weighted += weight * sampleSpatialCorrelation2Reference(node, position, {
      correlationLength: wavelength,
      mean: 0,
      amplitude: 1,
    });
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

export function createGrassMaterialFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({
    kind: 'grass-multiscale-field:v1',
    identity: root,
    maxOctaves: MAX_OCTAVES,
  });
  fieldState.set(field, {
    fieldNode: conditionChild(root, {
      segment: 'grass:field:v1',
      channel: 'field-variation',
    }),
    patchNode: conditionChild(root, {
      segment: 'grass:patch:v1',
      channel: 'patch-variation',
    }),
    detailNode: conditionChild(root, {
      segment: 'grass:blade-surface:v1',
      channel: 'blade-surface-variation',
    }),
  });
  return field;
}

export function sampleGrassMaterialReference(
  field,
  position,
  { detailLevel, footprint },
) {
  const state = fieldState.get(field);
  if (!state) {
    throw new TypeError('grass material field is required');
  }
  requirePosition(position);
  requireOptions({ detailLevel, footprint });
  const fieldVariation = sampleSpatialCorrelation2Reference(
    state.fieldNode,
    position,
    { correlationLength: 24, mean: 0, amplitude: 1 },
  );
  const patchVariation = sampleSpatialCorrelation2Reference(
    state.patchNode,
    position,
    { correlationLength: 3, mean: 0, amplitude: 1 },
  );
  const surfaceVariation = sampleDetail(
    state.detailNode,
    position,
    detailLevel,
    footprint,
  );
  const vigor = clamp(
    0.58 + 0.23 * fieldVariation + 0.14 * patchVariation,
    0,
    1,
  );
  const colorBlend = clamp(vigor + 0.08 * surfaceVariation, 0, 1);
  return Object.freeze({
    fieldVariation,
    patchVariation,
    surfaceVariation,
    coverage: clamp(0.68 + 0.22 * fieldVariation + 0.1 * patchVariation, 0, 1),
    bladeHeight: clamp(0.2 + 0.44 * vigor + 0.05 * surfaceVariation, 0.18, 0.72),
    roughness: clamp(0.94 - 0.16 * vigor + 0.03 * surfaceVariation, 0.72, 0.98),
    baseColor: Object.freeze([
      DRY_COLOR[0] + (LUSH_COLOR[0] - DRY_COLOR[0]) * colorBlend,
      DRY_COLOR[1] + (LUSH_COLOR[1] - DRY_COLOR[1]) * colorBlend,
      DRY_COLOR[2] + (LUSH_COLOR[2] - DRY_COLOR[2]) * colorBlend,
      1,
    ]),
  });
}
