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

fn vf_weathered_granite_sample(
  surface_coordinates: vec2<f32>,
  footprint: f32,
  detail_level: u32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> VfRockMaterialSample {
  let broad = vf_rock_raw_geology(surface_coordinates, footprint, detail_level, counter_prefix, key);
  let grainWeight = 1.0 - smoothstep(0.018, 0.060, footprint);
  let grain = vf_rock_spatial(surface_coordinates * 22.0 + vec2<f32>(7.3, -4.1), 0.18, counter_prefix, key) * grainWeight;
  let quartz = smoothstep(0.55, 0.78, grain);
  let mica = 1.0 - smoothstep(-0.78, -0.57, grain);
  let veinField = vf_rock_spatial(surface_coordinates * 1.7 + vec2<f32>(3.7, 8.1), 0.31, counter_prefix, key) + broad * 0.20;
  let vein = (1.0 - smoothstep(0.015, 0.052, abs(veinField))) * (1.0 - smoothstep(0.02, 0.08, footprint));
  let crackField = vf_rock_spatial(surface_coordinates * 0.92 + vec2<f32>(-5.2, 2.6), 0.24, counter_prefix, key) + broad * 0.14;
  let crack = (1.0 - smoothstep(0.006, 0.018, abs(crackField))) * (1.0 - smoothstep(0.025, 0.10, footprint));
  var granite = vec3<f32>(0.58, 0.565, 0.545) + vec3<f32>(0.10, 0.09, 0.075) * broad;
  granite = mix(granite, vec3<f32>(0.77, 0.75, 0.72), quartz * 0.60);
  granite = mix(granite, vec3<f32>(0.23, 0.24, 0.25), mica * 0.48);
  granite = mix(granite, vec3<f32>(0.68, 0.57, 0.53), vein * 0.24);
  granite *= 1.0 - crack * 0.12;
  let height = broad * 0.045 + grain * 0.018 * grainWeight - crack * 0.025;
  let step = 0.0012;
  let broadU = vf_rock_raw_geology(surface_coordinates + vec2<f32>(step, 0.0), footprint, detail_level, counter_prefix, key);
  let broadV = vf_rock_raw_geology(surface_coordinates + vec2<f32>(0.0, step), footprint, detail_level, counter_prefix, key);
  let derivative = vec2<f32>(broadU - broad, broadV - broad) / step;
  let tangentNormal = normalize(vec3<f32>(-derivative * 0.055, 1.0));
  return VfRockMaterialSample(
    broad,
    clamp(0.5 + broad * 0.5, 0.0, 1.0),
    vec4<f32>(clamp(granite, vec3<f32>(0.04), vec3<f32>(0.88)), 1.0),
    clamp(0.72 - broad * 0.10 + crack * 0.16 - quartz * 0.08, 0.48, 0.90),
    clamp(height, -0.08, 0.08),
    derivative,
    tangentNormal,
  );
}

fn vf_granite_micro_height(
  coordinates: vec2<f32>,
  footprint: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let weight0 = vf_rock_filter_weight(0.045, footprint);
  let weight1 = vf_rock_filter_weight(0.0225, footprint);
  let weight2 = vf_rock_filter_weight(0.01125, footprint);
  return
    0.0080 * weight0 * vf_rock_spatial(coordinates, 0.045, counter_prefix, key)
    + 0.0042 * weight1 * vf_rock_spatial(coordinates, 0.0225, counter_prefix, key)
    + 0.0021 * weight2 * vf_rock_spatial(coordinates, 0.01125, counter_prefix, key);
}

fn vf_weathered_granite_microrelief_sample(
  coordinates: vec2<f32>,
  footprint: f32,
  detail_level: u32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> VfRockMaterialSample {
  let base = vf_weathered_granite_sample(
    coordinates, footprint, detail_level, counter_prefix, key,
  );
  let step = 0.0007;
  let center = vf_granite_micro_height(coordinates, footprint, counter_prefix, key);
  let derivative = vec2<f32>(
    vf_granite_micro_height(coordinates + vec2<f32>(step, 0.0), footprint, counter_prefix, key)
      - vf_granite_micro_height(coordinates - vec2<f32>(step, 0.0), footprint, counter_prefix, key),
    vf_granite_micro_height(coordinates + vec2<f32>(0.0, step), footprint, counter_prefix, key)
      - vf_granite_micro_height(coordinates - vec2<f32>(0.0, step), footprint, counter_prefix, key),
  ) / (2.0 * step);
  let boundedSlope = clamp(derivative * 0.12, vec2<f32>(-0.48), vec2<f32>(0.48));
  let roughnessWeight = vf_rock_filter_weight(0.028, footprint);
  let roughnessNoise = vf_rock_spatial(
    coordinates + vec2<f32>(11.7, -6.2), 0.028, counter_prefix, key,
  ) * roughnessWeight;
  return VfRockMaterialSample(
    base.geology,
    base.weathering,
    base.base_color,
    clamp(base.roughness + roughnessNoise * 0.13, 0.48, 0.90),
    clamp(base.displacement + center, -0.08, 0.08),
    boundedSlope,
    normalize(vec3<f32>(-boundedSlope, 1.0)),
  );
}

fn vf_granite_micro_visibility(
  coordinates: vec2<f32>,
  footprint: f32,
  light_coordinates: vec2<f32>,
  incidence: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let horizontal = length(light_coordinates);
  let fade = smoothstep(0.04, 0.14, incidence)
    * (1.0 - smoothstep(0.28, 0.86, incidence))
    * vf_rock_filter_weight(0.045, footprint);
  if (horizontal <= 0.000001 || fade <= 0.0) {
    return 1.0;
  }
  let direction = light_coordinates / horizontal;
  let origin = vf_granite_micro_height(coordinates, footprint, counter_prefix, key);
  let step_distance = max(0.0018, footprint * 1.05);
  for (var step_index = 1u; step_index <= 8u; step_index += 1u) {
    let travel = step_distance * f32(step_index);
    let terrain = vf_granite_micro_height(
      coordinates + direction * travel, footprint, counter_prefix, key,
    );
    let ray_height = origin + travel * max(incidence, 0.0) / max(horizontal, 0.08);
    if (terrain > ray_height + 0.00005) {
      return 1.0 - 0.86 * fade;
    }
  }
  return 1.0;
}

fn vf_granite_noise3(
  position: vec3<f32>,
  wavelength: f32,
  salt: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let xy = vf_rock_spatial(
    position.xy + vec2<f32>(salt, -salt * 0.37), wavelength, counter_prefix, key,
  );
  let yz = vf_rock_spatial(
    position.yz + vec2<f32>(salt * 1.7, salt * 0.61), wavelength, counter_prefix, key,
  );
  let zx = vf_rock_spatial(
    position.zx + vec2<f32>(-salt * 0.83, salt * 1.13), wavelength, counter_prefix, key,
  );
  return (xy + yz + zx) * 0.57735026919;
}

fn vf_granite_granular_height(
  position: vec3<f32>,
  footprint: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let broadWeight = vf_rock_filter_weight(0.052, footprint);
  let grainWeight = vf_rock_filter_weight(0.025, footprint);
  let fineWeight = vf_rock_filter_weight(0.0125, footprint);
  let broad = vf_granite_noise3(position, 0.052, 2.3, counter_prefix, key);
  let grain = vf_granite_noise3(position, 0.025, 7.1, counter_prefix, key);
  let fine = vf_granite_noise3(position, 0.0125, 13.7, counter_prefix, key);
  let peak = pow(max(grain - 0.20, 0.0), 2.0) * 0.012;
  let pit = pow(max(-fine - 0.38, 0.0), 2.0) * 0.009;
  return broadWeight * broad * 0.0035
    + grainWeight * (grain * 0.0045 + peak)
    + fineWeight * (fine * 0.0012 - pit);
}

fn vf_granite_granular_gradient(
  position: vec3<f32>,
  footprint: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> vec3<f32> {
  let step = 0.0007;
  return vec3<f32>(
    vf_granite_granular_height(position + vec3<f32>(step, 0.0, 0.0), footprint, counter_prefix, key)
      - vf_granite_granular_height(position - vec3<f32>(step, 0.0, 0.0), footprint, counter_prefix, key),
    vf_granite_granular_height(position + vec3<f32>(0.0, step, 0.0), footprint, counter_prefix, key)
      - vf_granite_granular_height(position - vec3<f32>(0.0, step, 0.0), footprint, counter_prefix, key),
    vf_granite_granular_height(position + vec3<f32>(0.0, 0.0, step), footprint, counter_prefix, key)
      - vf_granite_granular_height(position - vec3<f32>(0.0, 0.0, step), footprint, counter_prefix, key),
  ) / (2.0 * step);
}

fn vf_weathered_granite_granular_sample(
  position: vec3<f32>,
  footprint: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> VfRockMaterialSample {
  let broad = vf_granite_noise3(position, 0.31, 1.1, counter_prefix, key);
  let feldspar = smoothstep(
    -0.20, 0.25,
    vf_granite_noise3(position, 0.055, 23.7, counter_prefix, key)
      * vf_rock_filter_weight(0.055, footprint),
  );
  let quartz = smoothstep(
    0.15, 0.48,
    vf_granite_noise3(position, 0.034, 31.1, counter_prefix, key)
      * vf_rock_filter_weight(0.034, footprint),
  );
  let mica = smoothstep(
    0.72, 0.94,
    vf_granite_noise3(position, 0.009, 47.3, counter_prefix, key)
      * vf_rock_filter_weight(0.009, footprint),
  );
  var granite = vec3<f32>(0.50, 0.485, 0.47) + broad * vec3<f32>(0.012, 0.011, 0.010);
  granite = mix(granite, vec3<f32>(0.72, 0.595, 0.53), feldspar * 0.62);
  granite = mix(granite, vec3<f32>(0.76, 0.75, 0.72), quartz * 0.66);
  granite = mix(granite, vec3<f32>(0.23, 0.24, 0.25), mica * 0.55);
  let roughNoise = vf_granite_noise3(position, 0.030, 19.1, counter_prefix, key)
    * vf_rock_filter_weight(0.030, footprint);
  let height = vf_granite_granular_height(position, footprint, counter_prefix, key);
  return VfRockMaterialSample(
    broad,
    clamp(0.5 + broad * 0.5, 0.0, 1.0),
    vec4<f32>(clamp(granite, vec3<f32>(0.20), vec3<f32>(0.82)), 1.0),
    clamp(
      0.82 + roughNoise * 0.055 + feldspar * 0.025 - quartz * 0.15 + mica * 0.045,
      0.64, 0.93,
    ),
    clamp(height, -0.04, 0.04),
    vec2<f32>(0.0),
    vec3<f32>(0.0, 0.0, 1.0),
  );
}

fn vf_granite_granular_normal(
  position: vec3<f32>,
  footprint: f32,
  base_normal: vec3<f32>,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> vec3<f32> {
  let gradient = clamp(
    vf_granite_granular_gradient(position, footprint, counter_prefix, key) * 0.28,
    vec3<f32>(-0.62), vec3<f32>(0.62),
  );
  let tangentGradient = gradient - base_normal * dot(gradient, base_normal);
  return normalize(base_normal - tangentGradient);
}

fn vf_granite_granular_visibility(
  position: vec3<f32>,
  footprint: f32,
  tangent_light: vec3<f32>,
  incidence: f32,
  counter_prefix: vec2<u32>,
  key: vec2<u32>,
) -> f32 {
  let horizontal = length(tangent_light);
  let fade = smoothstep(0.02, 0.10, incidence)
    * (1.0 - smoothstep(0.48, 0.90, incidence))
    * vf_rock_filter_weight(0.052, footprint);
  if (horizontal <= 0.000001 || fade <= 0.0) {
    return 1.0;
  }
  let direction = tangent_light / horizontal;
  let origin = vf_granite_granular_height(position, footprint, counter_prefix, key);
  let stepDistance = max(0.0030, footprint * 1.20);
  for (var stepIndex = 1u; stepIndex <= 8u; stepIndex += 1u) {
    let travel = stepDistance * f32(stepIndex);
    let terrain = vf_granite_granular_height(
      position + direction * travel, footprint, counter_prefix, key,
    );
    let rayHeight = origin + travel * max(incidence, 0.0) / max(horizontal * 1.85, 0.08);
    if (terrain > rayHeight + 0.00005) {
      return 1.0 - 0.94 * fade;
    }
  }
  return 1.0;
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

const PARITY_TOLERANCE = Object.freeze([
  0.0002, 0.0002, 0.0002, 0.0002,
  0.0002, 0.0002, 0.0002, 0.0002,
  0.02, 0.02, 0, 0,
  0.005, 0.005, 0.005, 0,
]);

export function verifyRockMaterialGpuParity(fixture, actual) {
  if (!fixture?.expected || !actual || actual.length !== fixture.expected.length) {
    throw new TypeError(
      `rock GPU readback must contain ${fixture?.expected?.length ?? 0} floats`,
    );
  }
  let maxAbsoluteError = 0;
  for (let index = 0; index < actual.length; index += 1) {
    if (!Number.isFinite(actual[index])) {
      throw new RangeError(`rock GPU readback[${index}] must be finite`);
    }
    const error = Math.abs(actual[index] - fixture.expected[index]);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    const lane = index % fixture.outputStrideFloats;
    const tolerance = PARITY_TOLERANCE[lane];
    if (error > tolerance) {
      return {
        matched: false,
        record: Math.floor(index / fixture.outputStrideFloats),
        lane,
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
