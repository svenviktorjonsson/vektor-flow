import { philox4x32_10 } from './vf-demand-random.mjs';

const U32_RANGE = 0x100000000;

export const GRASS_BLADE_COMPUTE_WGSL = /* wgsl */`
struct VfPhiloxProduct {
  high: u32,
  low: u32,
}

struct VfGrassCell {
  cell: vec2<i32>,
  key: vec2<u32>,
  counter_prefix: vec2<u32>,
  material: vec2<f32>,
  color: vec4<f32>,
}

struct VfGrassBladeInstance {
  origin_height: vec4<f32>,
  direction_width_roughness: vec4<f32>,
  lean: vec4<f32>,
  color: vec4<f32>,
}

struct VfGrassComputeParameters {
  instance_count: u32,
  blades_per_cell: u32,
  cell_count: u32,
  reserved: u32,
}

@group(0) @binding(0)
var<storage, read> vf_grass_cells: array<VfGrassCell>;

@group(0) @binding(1)
var<storage, read_write> vf_grass_blade_instances: array<VfGrassBladeInstance>;

@group(0) @binding(2)
var<uniform> vf_grass_parameters: VfGrassComputeParameters;

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

fn vf_grass_uniform(cell: VfGrassCell, blade_index: u32, lane: u32) -> f32 {
  let words = vf_philox4x32_10(
    vec4<u32>(cell.counter_prefix, blade_index, lane),
    cell.key,
  );
  return f32(words.x) * 2.3283064365386963e-10;
}

fn vf_grass_bounded(
  cell: VfGrassCell,
  blade_index: u32,
  lane: u32,
  minimum: f32,
  maximum: f32,
) -> f32 {
  return minimum + (maximum - minimum) * vf_grass_uniform(cell, blade_index, lane);
}

fn vf_grass_write_instance(instance_index: u32, blades_per_cell: u32) {
  let cell_index = instance_index / blades_per_cell;
  if (cell_index >= vf_grass_parameters.cell_count) {
    return;
  }
  let blade_index = instance_index % blades_per_cell;
  let cell = vf_grass_cells[cell_index];
  let blade_direction = vf_grass_bounded(cell, blade_index, 4u, 0.0, 3.141592653589793);
  let lean_direction = vf_grass_bounded(cell, blade_index, 5u, 0.0, 6.283185307179586);
  let color_shift = vf_grass_bounded(cell, blade_index, 6u, -0.035, 0.035);
  let lean_amount = cell.material.x
    * vf_grass_bounded(cell, blade_index, 7u, 0.02, 0.16);
  vf_grass_blade_instances[instance_index] = VfGrassBladeInstance(
    vec4<f32>(
      f32(cell.cell.x) + vf_grass_bounded(cell, blade_index, 0u, 0.08, 0.92),
      f32(cell.cell.y) + vf_grass_bounded(cell, blade_index, 1u, 0.08, 0.92),
      0.0,
      cell.material.x * vf_grass_bounded(cell, blade_index, 2u, 0.72, 1.28),
    ),
    vec4<f32>(
      cos(blade_direction),
      sin(blade_direction),
      vf_grass_bounded(cell, blade_index, 3u, 0.012, 0.028),
      cell.material.y,
    ),
    vec4<f32>(
      cos(lean_direction) * lean_amount,
      sin(lean_direction) * lean_amount,
      0.0,
      0.0,
    ),
    vec4<f32>(
      clamp(cell.color.x + color_shift * 0.4, 0.0, 1.0),
      clamp(cell.color.y + color_shift, 0.0, 1.0),
      clamp(cell.color.z + color_shift * 0.2, 0.0, 1.0),
      cell.color.w,
    ),
  );
}

@compute @workgroup_size(64)
fn vf_grass_blade_compute(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= vf_grass_parameters.instance_count) {
    return;
  }
  vf_grass_write_instance(id.x, vf_grass_parameters.blades_per_cell);
}

@compute @workgroup_size(64)
fn vf_grass_shadow_blade_compute(@builtin(global_invocation_id) id: vec3<u32>) {
  let shadow_blades_per_cell = max(1u, vf_grass_parameters.blades_per_cell / 2u);
  let full_cells = vf_grass_parameters.instance_count / vf_grass_parameters.blades_per_cell;
  let final_cell_blades = vf_grass_parameters.instance_count % vf_grass_parameters.blades_per_cell;
  let shadow_instance_count = (full_cells * shadow_blades_per_cell)
    + min(final_cell_blades, shadow_blades_per_cell);
  if (id.x >= shadow_instance_count) {
    return;
  }
  vf_grass_write_instance(id.x, shadow_blades_per_cell);
}
`;

function requireGrassGpu(grassGpu, instanceCount) {
  if (!grassGpu || grassGpu.kind !== 'grass-blade-philox:v1') {
    throw new TypeError('grass GPU descriptor is required');
  }
  if (!(grassGpu.cell_records instanceof Uint32Array)) {
    throw new TypeError('grass GPU cell records must be Uint32Array');
  }
  if (grassGpu.cell_stride_words !== 12
      || grassGpu.cell_records.length % grassGpu.cell_stride_words !== 0) {
    throw new RangeError('grass GPU cell records must use twelve-word records');
  }
  if (!Number.isSafeInteger(grassGpu.blades_per_cell) || grassGpu.blades_per_cell <= 0) {
    throw new RangeError('grass GPU blades_per_cell must be a positive safe integer');
  }
  if (!Number.isSafeInteger(instanceCount) || instanceCount < 0
      || instanceCount > grassGpu.cell_records.length / 12 * grassGpu.blades_per_cell) {
    throw new RangeError('grass GPU instance count exceeds the cell descriptors');
  }
}

export function reconstructGrassBladeGpuInstancesReference(grassGpu, instanceCount) {
  requireGrassGpu(grassGpu, instanceCount);
  const words = grassGpu.cell_records;
  const signed = new Int32Array(words.buffer, words.byteOffset, words.length);
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  const output = new Float32Array(instanceCount * 16);
  for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
    const cellIndex = Math.floor(instanceIndex / grassGpu.blades_per_cell);
    const bladeIndex = instanceIndex % grassGpu.blades_per_cell;
    const base = cellIndex * 12;
    const key = [words[base + 2], words[base + 3]];
    const prefix = [words[base + 4], words[base + 5]];
    const uniform = (lane) => philox4x32_10(
      [prefix[0], prefix[1], bladeIndex, lane],
      key,
    )[0] / U32_RANGE;
    const bounded = (lane, minimum, maximum) => (
      minimum + (maximum - minimum) * uniform(lane)
    );
    const bladeHeight = floats[base + 6];
    const bladeDirection = bounded(4, 0, Math.PI);
    const leanDirection = bounded(5, 0, Math.PI * 2);
    const colorShift = bounded(6, -0.035, 0.035);
    const leanAmount = bladeHeight * bounded(7, 0.02, 0.16);
    output.set([
      signed[base] + bounded(0, 0.08, 0.92),
      signed[base + 1] + bounded(1, 0.08, 0.92),
      0,
      bladeHeight * bounded(2, 0.72, 1.28),
      Math.cos(bladeDirection),
      Math.sin(bladeDirection),
      bounded(3, 0.012, 0.028),
      floats[base + 7],
      Math.cos(leanDirection) * leanAmount,
      Math.sin(leanDirection) * leanAmount,
      0,
      0,
      Math.max(0, Math.min(1, floats[base + 8] + colorShift * 0.4)),
      Math.max(0, Math.min(1, floats[base + 9] + colorShift)),
      Math.max(0, Math.min(1, floats[base + 10] + colorShift * 0.2)),
      floats[base + 11],
    ], instanceIndex * 16);
  }
  return output;
}
