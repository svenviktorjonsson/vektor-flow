import { philox4x32_10 } from './vf-demand-random.mjs';

const U32_RANGE = 0x100000000;
const MICRO_OCTAVES = Object.freeze([
  Object.freeze({ detailLevel: 4, wavelength: 1 / 64, amplitude: 1 }),
  Object.freeze({ detailLevel: 5, wavelength: 1 / 128, amplitude: 0.5 }),
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function filterWeight(wavelength, footprint) {
  if (footprint <= wavelength * 0.5) return 1;
  if (footprint >= wavelength) return 0;
  const ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3 - 2 * ratio);
}

function requireOptions({
  baseColor,
  roughness,
  stream,
  bladeIndex,
  detailLevel,
  footprint,
}) {
  if (!Array.isArray(baseColor) || baseColor.length !== 4
      || baseColor.some((value) => !Number.isFinite(value))) {
    throw new TypeError('grass material baseColor must contain four finite numbers');
  }
  if (!Number.isFinite(roughness)) {
    throw new TypeError('grass material roughness must be finite');
  }
  if (!stream || !Array.isArray(stream.key) || stream.key.length !== 2
      || !Array.isArray(stream.counterPrefix) || stream.counterPrefix.length !== 2) {
    throw new TypeError('grass material conditioned stream is required');
  }
  if (!Number.isSafeInteger(bladeIndex) || bladeIndex < 0) {
    throw new RangeError('grass material bladeIndex must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(detailLevel) || detailLevel < 0) {
    throw new RangeError('grass material detailLevel must be a non-negative safe integer');
  }
  if (!Number.isFinite(footprint) || footprint < 0) {
    throw new RangeError('grass material footprint must be finite and non-negative');
  }
}

function signedUniform(stream, bladeIndex, lane) {
  const word = philox4x32_10(
    [stream.counterPrefix[0], stream.counterPrefix[1], bladeIndex, lane],
    stream.key,
  )[0];
  return -1 + 2 * word / U32_RANGE;
}

export function sampleGrassMaterialLodReference(options) {
  requireOptions(options);
  const {
    baseColor,
    roughness,
    stream,
    bladeIndex,
    detailLevel,
    footprint,
  } = options;
  if (detailLevel <= 3) {
    return Object.freeze({ baseColor, roughness });
  }
  let colorResidual = 0;
  let roughnessResidual = 0;
  for (let octave = 0; octave < MICRO_OCTAVES.length; octave += 1) {
    const descriptor = MICRO_OCTAVES[octave];
    if (detailLevel < descriptor.detailLevel) continue;
    const weight = descriptor.amplitude
      * filterWeight(descriptor.wavelength, footprint);
    if (!(weight > 0)) continue;
    colorResidual += weight * signedUniform(stream, bladeIndex, 8 + octave * 2);
    roughnessResidual += weight * signedUniform(stream, bladeIndex, 9 + octave * 2);
  }
  if (colorResidual === 0 && roughnessResidual === 0) {
    return Object.freeze({ baseColor, roughness });
  }
  return Object.freeze({
    baseColor: Object.freeze([
      clamp(baseColor[0] + colorResidual * 0.014, 0, 1),
      clamp(baseColor[1] + colorResidual * 0.028, 0, 1),
      clamp(baseColor[2] + colorResidual * 0.009, 0, 1),
      baseColor[3],
    ]),
    roughness: clamp(roughness + roughnessResidual * 0.02, 0.72, 0.98),
  });
}
