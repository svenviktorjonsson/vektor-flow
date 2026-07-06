"""WebGPU kernel source for high-count 2D hard-disc simulation.

The scalar hard-disc world remains the correctness reference.  This module
contains the GPU execution surface needed for dense 2D scenes where a
pair-by-pair CPU broadphase is not acceptable.
"""

from __future__ import annotations

from dataclasses import dataclass

from vektorflow.physics.gpu_pipeline import GpuPhysicsPipelineSpec, gpu_physics_pipeline_spec


@dataclass(frozen=True, slots=True)
class GpuHardDiscKernelSpec:
    """Packed WebGPU hard-disc kernel contract."""

    workgroup_size: int
    particle_stride_f32: int
    params_stride_f32: int
    pipeline: GpuPhysicsPipelineSpec
    collider_kind: str
    wgsl: str


HARD_DISC_PARTICLE_STRIDE_F32 = 8
HARD_DISC_PARAMS_STRIDE_F32 = 16
HARD_DISC_WORKGROUP_SIZE = 128


def hard_disc_gpu_kernel_spec() -> GpuHardDiscKernelSpec:
    return GpuHardDiscKernelSpec(
        workgroup_size=HARD_DISC_WORKGROUP_SIZE,
        particle_stride_f32=HARD_DISC_PARTICLE_STRIDE_F32,
        params_stride_f32=HARD_DISC_PARAMS_STRIDE_F32,
        pipeline=gpu_physics_pipeline_spec(2, wgsl=HARD_DISC_GPU_WGSL),
        collider_kind="disc_2d",
        wgsl=HARD_DISC_GPU_WGSL,
    )


HARD_DISC_GPU_WGSL = """
struct Particle {
  pos_radius: vec4<f32>,   // x, y, radius, density
  vel_mass: vec4<f32>,     // vx, vy, mass, pad
};

struct Params {
  world: vec4<f32>,        // width, height, restitution, dt
  gravity: vec4<f32>,      // gx, gy, contact_band_ratio, particle_count
  grid: vec4<f32>,         // cell_size, cols, rows, max_particles_per_cell
  pass: vec4<f32>,         // pass_index, pass_count, pad, pad
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> cell_counts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> cell_items: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> collision_matrix: array<vec4<f32>>;

fn particle_count() -> u32 {
  return u32(params.gravity.w);
}

fn grid_cols() -> u32 {
  return u32(params.grid.y);
}

fn grid_rows() -> u32 {
  return u32(params.grid.z);
}

fn max_items_per_cell() -> u32 {
  return u32(params.grid.w);
}

fn cell_index_for_position(p: vec2<f32>) -> u32 {
  let cx = clamp(i32(floor(p.x / params.grid.x)), 0, i32(grid_cols()) - 1);
  let cy = clamp(i32(floor(p.y / params.grid.x)), 0, i32(grid_rows()) - 1);
  return u32(cy) * grid_cols() + u32(cx);
}

@compute @workgroup_size(128)
fn clear_cells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let cell_count = grid_cols() * grid_rows();
  if (index >= cell_count) {
    return;
  }
  atomicStore(&cell_counts[index], 0u);
}

@compute @workgroup_size(128)
fn integrate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= particle_count()) {
    return;
  }
  var p = particles[index];
  let dt = params.world.w;
  let g = params.gravity.xy;
  p.pos_radius.xy = p.pos_radius.xy + p.vel_mass.xy * dt + 0.5 * g * dt * dt;
  p.vel_mass.xy = p.vel_mass.xy + g * dt;

  let r = p.pos_radius.z;
  if (p.pos_radius.x < r) {
    p.pos_radius.x = r;
    p.vel_mass.x = abs(p.vel_mass.x) * params.world.z;
  }
  if (p.pos_radius.x > params.world.x - r) {
    p.pos_radius.x = params.world.x - r;
    p.vel_mass.x = -abs(p.vel_mass.x) * params.world.z;
  }
  if (p.pos_radius.y < r) {
    p.pos_radius.y = r;
    p.vel_mass.y = abs(p.vel_mass.y) * params.world.z;
  }
  if (p.pos_radius.y > params.world.y - r) {
    p.pos_radius.y = params.world.y - r;
    p.vel_mass.y = -abs(p.vel_mass.y) * params.world.z;
  }
  particles[index] = p;
}

@compute @workgroup_size(128)
fn fill_cells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= particle_count()) {
    return;
  }
  let cell = cell_index_for_position(particles[index].pos_radius.xy);
  let slot = atomicAdd(&cell_counts[cell], 1u);
  if (slot < max_items_per_cell()) {
    cell_items[cell * max_items_per_cell() + slot] = index;
  }
}

fn resolve_pair(i: u32, j: u32) {
  if (i == j) {
    return;
  }
  var a = particles[i];
  var b = particles[j];
  let delta = b.pos_radius.xy - a.pos_radius.xy;
  let min_dist = a.pos_radius.z + b.pos_radius.z;
  let contact_band = min(a.pos_radius.z, b.pos_radius.z) * params.gravity.z;
  let material = collision_matrix[0u];
  let restitution = select(params.world.z, material.x, material.w > 0.5);
  let target_dist = min_dist + contact_band;
  let dist_sq = dot(delta, delta);
  if (dist_sq >= target_dist * target_dist) {
    return;
  }
  let dist = sqrt(max(dist_sq, 1.0e-20));
  let n = select(vec2<f32>(1.0, 0.0), delta / dist, dist_sq > 1.0e-20);
  let overlap = target_dist - select(0.0, dist, dist_sq > 1.0e-20);
  let inv_a = 1.0 / a.vel_mass.z;
  let inv_b = 1.0 / b.vel_mass.z;
  let inv_sum = inv_a + inv_b;
  let correction = overlap / inv_sum;
  a.pos_radius.xy = a.pos_radius.xy - n * correction * inv_a;
  b.pos_radius.xy = b.pos_radius.xy + n * correction * inv_b;

  let relative_normal_speed = dot(a.vel_mass.xy - b.vel_mass.xy, n);
  let desired_separation_speed = max(0.0, overlap / max(params.world.w, 1.0e-6));
  let bounce_speed = select(relative_normal_speed, -restitution * relative_normal_speed, relative_normal_speed > 0.0);
  let target_speed = min(-desired_separation_speed, bounce_speed);
  if (relative_normal_speed > target_speed) {
    let impulse = (relative_normal_speed - target_speed) / inv_sum;
    a.vel_mass.xy = a.vel_mass.xy - impulse * inv_a * n;
    b.vel_mass.xy = b.vel_mass.xy + impulse * inv_b * n;
  }

  particles[i] = a;
  particles[j] = b;
}

@compute @workgroup_size(128)
fn resolve_contacts(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= particle_count()) {
    return;
  }
  let p = particles[index];
  let base_cell = cell_index_for_position(p.pos_radius.xy);
  let cx = i32(base_cell % grid_cols());
  let cy = i32(base_cell / grid_cols());
  for (var oy: i32 = -1; oy <= 1; oy = oy + 1) {
    for (var ox: i32 = -1; ox <= 1; ox = ox + 1) {
      let nx = cx + ox;
      let ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= i32(grid_cols()) || ny >= i32(grid_rows())) {
        continue;
      }
      let cell = u32(ny) * grid_cols() + u32(nx);
      let count = min(atomicLoad(&cell_counts[cell]), max_items_per_cell());
      for (var slot: u32 = 0u; slot < count; slot = slot + 1u) {
        let other = cell_items[cell * max_items_per_cell() + slot];
        if (other > index) {
          resolve_pair(index, other);
        }
      }
    }
  }
}
"""
