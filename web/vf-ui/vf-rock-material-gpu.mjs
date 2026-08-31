// Internal WGSL reference for the MAT030 shared geology/weathering field.
// Stream words are pre-derived on the CPU; every lattice corner remains an
// order-independent Philox4x32-10 counter query on the GPU.
export const ROCK_MATERIAL_WGSL = /* wgsl */`
struct VfRockPhiloxProduct {
  high: u32,
  low: u32,
}

struct VfRockMaterialSample {
  geology: f32,
  weathering: f32,
  base_color: vec4<f32>,
  roughness: f32,
  displacement: f32,
  derivative: vec2<f32>,
  tangent_normal: vec3<f32>,
}

fn vf_rock_mulhilo_u32(left: u32, right: u32) -> VfRockPhiloxProduct {
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
  return VfRockPhiloxProduct(high, low);
}

fn vf_rock_philox_round(counter: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  let product0 = vf_rock_mulhilo_u32(0xd2511f53u, counter.x);
  let product1 = vf_rock_mulhilo_u32(0xcd9e8d57u, counter.z);
  return vec4<u32>(
    product1.high ^ counter.y ^ key.x,
    product1.low,
    product0.high ^ counter.w ^ key.y,
    product0.low,
  );
}

fn vf_rock_philox4x32_10(counter: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  var words = counter;
  var round_key = key;
  for (var round = 0u; round < 10u; round += 1u) {
    words = vf_rock_philox_round(words, round_key);
    round_key += vec2<u32>(0x9e3779b9u, 0xbb67ae85u);
  }
  return words;
}

fn vf_rock_corner_uniform(
  cell: vec2<i32>,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let words = vf_rock_philox4x32_10(
    vec4<u32>(counter_prefix, bitcast<vec2<u32>>(cell)),
    key,
  );
  return -1.0 + (2.0 * (f32(words.x) / 4294967296.0));
}

fn vf_rock_fade(value: f32) -> f32 {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

fn vf_rock_spatial(
  position: vec2<f32>,
  wavelength: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let scaled = position / wavelength;
  let cell_floor = floor(scaled);
  let cell = vec2<i32>(cell_floor);
  let fraction = scaled - cell_floor;
  let weight = vec2<f32>(vf_rock_fade(fraction.x), vf_rock_fade(fraction.y));
  let lower = mix(
    vf_rock_corner_uniform(cell, counter_prefix, key),
    vf_rock_corner_uniform(cell + vec2<i32>(1, 0), counter_prefix, key),
    weight.x,
  );
  let upper = mix(
    vf_rock_corner_uniform(cell + vec2<i32>(0, 1), counter_prefix, key),
    vf_rock_corner_uniform(cell + vec2<i32>(1, 1), counter_prefix, key),
    weight.x,
  );
  return mix(lower, upper, weight.y);
}

fn vf_rock_filter_weight(wavelength: f32, footprint: f32) -> f32 {
  if (footprint <= wavelength * 0.5) {
    return 1.0;
  }
  if (footprint >= wavelength) {
    return 0.0;
  }
  let ratio = (wavelength - footprint) / (wavelength * 0.5);
  return ratio * ratio * (3.0 - (2.0 * ratio));
}

fn vf_rock_raw_geology(
  surface_coordinates: vec2<f32>,
  footprint: f32,
  detail_level: u32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let octave_count = min(6u, detail_level + 2u);
  var weighted = 0.0;
  var total_weight = 0.0;
  for (var octave = 0u; octave < 6u; octave += 1u) {
    if (octave >= octave_count) {
      continue;
    }
    let wavelength = exp2(-f32(octave));
    let weight = pow(0.56, f32(octave)) * vf_rock_filter_weight(wavelength, footprint);
    if (weight > 0.0) {
      weighted += weight * vf_rock_spatial(surface_coordinates, wavelength, counter_prefix, key);
      total_weight += weight;
    }
  }
  return select(0.0, weighted / total_weight, total_weight > 0.0);
}

fn vf_rock_material_sample(
  surface_coordinates: vec2<f32>,
  footprint: f32,
  detail_level: u32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> VfRockMaterialSample {
  let geology = vf_rock_raw_geology(surface_coordinates, footprint, detail_level, counter_prefix, key);
  let derivative_step = 0.0001;
  let derivative_u = (
    vf_rock_raw_geology(surface_coordinates + vec2<f32>(derivative_step, 0.0), footprint, detail_level, counter_prefix, key)
    - vf_rock_raw_geology(surface_coordinates - vec2<f32>(derivative_step, 0.0), footprint, detail_level, counter_prefix, key)
  ) / (2.0 * derivative_step);
  let derivative_v = (
    vf_rock_raw_geology(surface_coordinates + vec2<f32>(0.0, derivative_step), footprint, detail_level, counter_prefix, key)
    - vf_rock_raw_geology(surface_coordinates - vec2<f32>(0.0, derivative_step), footprint, detail_level, counter_prefix, key)
  ) / (2.0 * derivative_step);
  let weathering = clamp(0.5 + (0.5 * geology), 0.0, 1.0);
  let base_color = vec4<f32>(
    mix(vec3<f32>(0.22, 0.19, 0.15), vec3<f32>(0.55, 0.49, 0.40), weathering),
    1.0,
  );
  let roughness = clamp(0.92 - (0.34 * weathering), 0.58, 0.92);
  let displacement = clamp(0.08 * geology, -0.08, 0.08);
  let tangent_normal = normalize(vec3<f32>(-derivative_u * 0.18, -derivative_v * 0.18, 1.0));
  return VfRockMaterialSample(
    geology,
    weathering,
    base_color,
    roughness,
    displacement,
    vec2<f32>(derivative_u, derivative_v),
    tangent_normal,
  );
}
`;

function requireRecord(record, index) {
  const descriptor = record?.descriptor;
  if (
    descriptor?.kind !== 'rock-geology-weathering-gpu:v1'
    || !Array.isArray(descriptor.streamWords)
    || descriptor.streamWords.length !== 4
  ) {
    throw new TypeError(`records[${index}] requires a rock GPU descriptor`);
  }
  if (!record.surfaceCoordinates || record.surfaceCoordinates.length !== 2) {
    throw new TypeError(`records[${index}].surfaceCoordinates requires two numbers`);
  }
  if (!Number.isFinite(record.footprint) || record.footprint < 0) {
    throw new RangeError(`records[${index}].footprint must be finite and non-negative`);
  }
  if (!record.expected || !record.expected.baseColor || !record.expected.derivative || !record.expected.tangentNormal) {
    throw new TypeError(`records[${index}].expected requires a CPU material sample`);
  }
}

export function createRockMaterialGpuParityFixture(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('rock GPU parity records must be an array');
  }
  const inputWords = new Uint32Array(records.length * 8);
  const inputFloats = new Float32Array(inputWords.buffer);
  const expected = new Float32Array(records.length * 16);
  records.forEach((record, index) => {
    requireRecord(record, index);
    const inputOffset = index * 8;
    inputFloats[inputOffset] = record.surfaceCoordinates[0];
    inputFloats[inputOffset + 1] = record.surfaceCoordinates[1];
    inputFloats[inputOffset + 2] = record.footprint;
    inputWords[inputOffset + 3] = record.descriptor.detailLevel;
    inputWords.set(record.descriptor.streamWords, inputOffset + 4);
    const outputOffset = index * 16;
    expected.set([
      record.expected.geology,
      record.expected.weathering,
      record.expected.roughness,
      record.expected.displacement,
      ...record.expected.baseColor,
      ...record.expected.derivative,
      0,
      0,
      ...record.expected.tangentNormal,
      0,
    ], outputOffset);
  });
  const source = `${ROCK_MATERIAL_WGSL}
struct VfRockParityInput {
  surface_footprint_detail: vec4<f32>,
  stream_words: vec4<u32>,
}
@group(0) @binding(0) var<storage, read> vf_rock_inputs: array<VfRockParityInput>;
@group(0) @binding(1) var<storage, read_write> vf_rock_outputs: array<vec4<f32>>;

@compute @workgroup_size(64)
fn vf_rock_parity_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&vf_rock_inputs)) {
    return;
  }
  let input = vf_rock_inputs[index];
  let sample = vf_rock_material_sample(
    input.surface_footprint_detail.xy,
    input.surface_footprint_detail.z,
    bitcast<u32>(input.surface_footprint_detail.w),
    input.stream_words.xy,
    input.stream_words.zw,
  );
  let base = index * 4u;
  vf_rock_outputs[base] = vec4<f32>(sample.geology, sample.weathering, sample.roughness, sample.displacement);
  vf_rock_outputs[base + 1u] = sample.base_color;
  vf_rock_outputs[base + 2u] = vec4<f32>(sample.derivative, 0.0, 0.0);
  vf_rock_outputs[base + 3u] = vec4<f32>(sample.tangent_normal, 0.0);
}
`;
  return Object.freeze({
    source,
    inputStrideWords: 8,
    outputStrideFloats: 16,
    inputWords,
    expected,
  });
}
