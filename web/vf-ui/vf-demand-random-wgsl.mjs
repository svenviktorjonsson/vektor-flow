import { philox4x32_10 } from './vf-demand-random.mjs';

// Internal WGSL parity seam for Random123 v1.14.0 Philox4x32-10.
// The complete upstream BSD notice is retained in vf-demand-random.mjs.
// This shader is not wired into the renderer or exposed as a named package API.
const PHILOX4X32_WGSL = /* wgsl */`
struct VfPhiloxProduct {
  high: u32,
  low: u32,
}

struct VfPhiloxInput {
  counter: vec4<u32>,
  key: vec2<u32>,
  reserved: vec2<u32>,
}

@group(0) @binding(0)
var<storage, read> vf_philox_inputs: array<VfPhiloxInput>;

@group(0) @binding(1)
var<storage, read_write> vf_philox_outputs: array<vec4<u32>>;

fn vf_mulhilo_u32(left: u32, right: u32) -> VfPhiloxProduct {
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
  return VfPhiloxProduct(high, low);
}

fn vf_philox4x32_round(counter: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  let product0 = vf_mulhilo_u32(0xd2511f53u, counter.x);
  let product1 = vf_mulhilo_u32(0xcd9e8d57u, counter.z);
  return vec4<u32>(
    product1.high ^ counter.y ^ key.x,
    product1.low,
    product0.high ^ counter.w ^ key.y,
    product0.low,
  );
}

fn vf_philox4x32_10(counter: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  var words = counter;
  var round_key = key;
  for (var round = 0u; round < 10u; round += 1u) {
    words = vf_philox4x32_round(words, round_key);
    round_key += vec2<u32>(0x9e3779b9u, 0xbb67ae85u);
  }
  return words;
}

@compute @workgroup_size(64)
fn vf_philox_parity_main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&vf_philox_inputs)) {
    return;
  }
  let input = vf_philox_inputs[index];
  vf_philox_outputs[index] = vf_philox4x32_10(input.counter, input.key);
}
`;

function requireExpected(words, label) {
  if (!words || words.length !== 4) {
    throw new TypeError(`${label} must contain four u32 words`);
  }
  for (let index = 0; index < words.length; index += 1) {
    const value = words[index];
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new TypeError(`${label}[${index}] must be a u32`);
    }
  }
}

export function createPhilox4x32WgslParityFixture(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('Philox WGSL parity records must be an array');
  }
  const inputWords = new Uint32Array(records.length * 8);
  const expectedWords = new Uint32Array(records.length * 4);
  records.forEach((record, index) => {
    requireExpected(record.expected, `records[${index}].expected`);
    const actual = philox4x32_10(record.counter, record.key);
    if (actual.some((word, wordIndex) => word !== record.expected[wordIndex])) {
      throw new Error(`records[${index}] disagrees with the CPU Philox reference`);
    }
    inputWords.set(record.counter, index * 8);
    inputWords.set(record.key, index * 8 + 4);
    expectedWords.set(record.expected, index * 4);
  });
  return {
    source: PHILOX4X32_WGSL,
    inputStrideWords: 8,
    inputWords,
    expectedWords,
  };
}

export function verifyPhilox4x32WgslParity(fixture, actualWords) {
  if (!actualWords || actualWords.length !== fixture.expectedWords.length) {
    throw new TypeError(
      `Philox WGSL readback must contain ${fixture.expectedWords.length} u32 words`,
    );
  }
  for (let index = 0; index < actualWords.length; index += 1) {
    const actual = actualWords[index];
    if (!Number.isInteger(actual) || actual < 0 || actual > 0xffffffff) {
      throw new TypeError(`Philox WGSL readback[${index}] must be a u32`);
    }
    const expected = fixture.expectedWords[index];
    if (actual !== expected) {
      return {
        matched: false,
        record: Math.floor(index / 4),
        lane: index % 4,
        expected,
        actual,
      };
    }
  }
  return {
    matched: true,
    records: actualWords.length / 4,
  };
}
