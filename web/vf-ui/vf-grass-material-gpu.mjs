import { philox4x32_10 } from './vf-demand-random.mjs';

const U32_RANGE = 0x100000000;
const MICRO_OCTAVES = Object.freeze([
  Object.freeze({ detailLevel: 4, wavelength: 1 / 64, amplitude: 1 }),
  Object.freeze({ detailLevel: 5, wavelength: 1 / 128, amplitude: 0.5 }),
]);

export const GRASS_MATERIAL_LOD_WGSL = /* wgsl */`
struct VfGrassMaterialPhiloxProduct {
  high: u32,
  low: u32,
}

struct VfGrassMaterialLodSample {
  base_color: vec4<f32>,
  roughness: f32,
}

fn vf_grass_material_mulhilo_u32(
  left: u32,
  right: u32,
) -> VfGrassMaterialPhiloxProduct {
  let low_mask = 0xffffu;
  let left_high = left >> 16u;
  let left_low = left & low_mask;
  let right_high = right >> 16u;
  let right_low = right & low_mask;
  let low = left * right;
  let high_low = left_high * right_low;
  let low_high = left_low * right_high;
  let cross_low = (high_low & low_mask) + (low_high & low_mask);
  var high = left_high * right_high
    + (high_low >> 16u)
    + (low_high >> 16u)
    + (cross_low >> 16u);
  if ((low >> 16u) < (cross_low & low_mask)) {
    high += 1u;
  }
  return VfGrassMaterialPhiloxProduct(high, low);
}

fn vf_grass_material_philox_round(
  counter: vec4<u32>,
  key: vec2<u32>,
) -> vec4<u32> {
  let product0 = vf_grass_material_mulhilo_u32(0xd2511f53u, counter.x);
  let product1 = vf_grass_material_mulhilo_u32(0xcd9e8d57u, counter.z);
  return vec4<u32>(
    product1.high ^ counter.y ^ key.x,
    product1.low,
    product0.high ^ counter.w ^ key.y,
    product0.low,
  );
}

fn vf_grass_material_philox4x32_10(
  counter: vec4<u32>,
  key: vec2<u32>,
) -> vec4<u32> {
  var words = counter;
  var round_key = key;
  for (var round = 0u; round < 10u; round += 1u) {
    words = vf_grass_material_philox_round(words, round_key);
    round_key += vec2<u32>(0x9e3779b9u, 0xbb67ae85u);
  }
  return words;
}

fn vf_grass_material_signed(
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
  blade_index: u32,
  lane: u32,
) -> f32 {
  let words = vf_grass_material_philox4x32_10(
    vec4<u32>(counter_prefix, blade_index, lane),
    key,
  );
  return -1.0 + 2.0 * (f32(words.x) / 4294967296.0);
}

fn vf_grass_material_filter_weight(wavelength: f32, footprint: f32) -> f32 {
  if (footprint <= wavelength * 0.5) {
    return 1.0;
  }
  if (footprint >= wavelength) {
    return 0.0;
  }
  let ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3.0 - 2.0 * ratio);
}

fn vf_grass_material_lod_sample(
  base_color: vec4<f32>,
  base_roughness: f32,
  detail_level: u32,
  footprint: f32,
  blade_index: u32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> VfGrassMaterialLodSample {
  if (detail_level <= 3u) {
    return VfGrassMaterialLodSample(base_color, base_roughness);
  }
  var color_residual = 0.0;
  var roughness_residual = 0.0;
  let first_weight = vf_grass_material_filter_weight(1.0 / 64.0, footprint);
  if (first_weight > 0.0) {
    color_residual += first_weight * vf_grass_material_signed(
      counter_prefix, key, blade_index, 8u,
    );
    roughness_residual += first_weight * vf_grass_material_signed(
      counter_prefix, key, blade_index, 9u,
    );
  }
  if (detail_level >= 5u) {
    let second_weight = 0.5
      * vf_grass_material_filter_weight(1.0 / 128.0, footprint);
    if (second_weight > 0.0) {
      color_residual += second_weight * vf_grass_material_signed(
        counter_prefix, key, blade_index, 10u,
      );
      roughness_residual += second_weight * vf_grass_material_signed(
        counter_prefix, key, blade_index, 11u,
      );
    }
  }
  if (color_residual == 0.0 && roughness_residual == 0.0) {
    return VfGrassMaterialLodSample(base_color, base_roughness);
  }
  return VfGrassMaterialLodSample(
    vec4<f32>(
      clamp(base_color.x + color_residual * 0.014, 0.0, 1.0),
      clamp(base_color.y + color_residual * 0.028, 0.0, 1.0),
      clamp(base_color.z + color_residual * 0.009, 0.0, 1.0),
      base_color.w,
    ),
    clamp(base_roughness + roughness_residual * 0.02, 0.72, 0.98),
  );
}
`;

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

export function createGrassMaterialLodGpuParityFixture(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('grass material GPU parity records must be an array');
  }
  const inputWords = new Uint32Array(records.length * 12);
  const inputFloats = new Float32Array(inputWords.buffer);
  const expected = new Float32Array(records.length * 8);
  records.forEach((record, index) => {
    requireOptions(record);
    if (!record.expected?.baseColor || !Number.isFinite(record.expected.roughness)) {
      throw new TypeError(`records[${index}].expected requires a CPU material sample`);
    }
    const inputOffset = index * 12;
    inputFloats.set(record.baseColor, inputOffset);
    inputFloats[inputOffset + 4] = record.roughness;
    inputFloats[inputOffset + 5] = record.footprint;
    inputWords[inputOffset + 6] = record.detailLevel;
    inputWords[inputOffset + 7] = record.bladeIndex;
    inputWords.set(record.stream.key, inputOffset + 8);
    inputWords.set(record.stream.counterPrefix, inputOffset + 10);
    const outputOffset = index * 8;
    expected.set(record.expected.baseColor, outputOffset);
    expected[outputOffset + 4] = record.expected.roughness;
  });
  const source = `${GRASS_MATERIAL_LOD_WGSL}
struct VfGrassMaterialParityInput {
  base_color: vec4<f32>,
  roughness_footprint_detail_blade: vec4<f32>,
  key: vec2<u32>,
  counter_prefix: vec2<u32>,
}
@group(0) @binding(0)
var<storage, read> vf_grass_material_inputs: array<VfGrassMaterialParityInput>;
@group(0) @binding(1)
var<storage, read_write> vf_grass_material_outputs: array<vec4<f32>>;

@compute @workgroup_size(64)
fn vf_grass_material_parity_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&vf_grass_material_inputs)) {
    return;
  }
  let input = vf_grass_material_inputs[index];
  let sample = vf_grass_material_lod_sample(
    input.base_color,
    input.roughness_footprint_detail_blade.x,
    bitcast<u32>(input.roughness_footprint_detail_blade.z),
    input.roughness_footprint_detail_blade.y,
    bitcast<u32>(input.roughness_footprint_detail_blade.w),
    input.counter_prefix,
    input.key,
  );
  let base = index * 2u;
  vf_grass_material_outputs[base] = sample.base_color;
  vf_grass_material_outputs[base + 1u] = vec4<f32>(sample.roughness, 0.0, 0.0, 0.0);
}
`;
  return Object.freeze({
    source,
    inputStrideWords: 12,
    outputStrideFloats: 8,
    inputWords,
    expected,
  });
}

export function verifyGrassMaterialLodGpuParity(fixture, actual) {
  if (!fixture?.expected || !actual || actual.length !== fixture.expected.length) {
    throw new TypeError(
      `grass material GPU readback must contain ${fixture?.expected?.length ?? 0} floats`,
    );
  }
  let maxAbsoluteError = 0;
  for (let index = 0; index < actual.length; index += 1) {
    if (!Number.isFinite(actual[index])) {
      throw new RangeError(`grass material GPU readback[${index}] must be finite`);
    }
    const error = Math.abs(actual[index] - fixture.expected[index]);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    const tolerance = 0.000002;
    if (error > tolerance) {
      return {
        matched: false,
        record: Math.floor(index / fixture.outputStrideFloats),
        lane: index % fixture.outputStrideFloats,
        expected: fixture.expected[index],
        actual: actual[index],
        tolerance,
      };
    }
  }
  return {
    matched: true,
    records: actual.length / fixture.outputStrideFloats,
    maxAbsoluteError,
  };
}
