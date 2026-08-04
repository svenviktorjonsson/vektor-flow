"""WebGPU kernel source for high-count 3D hard-sphere simulation."""

from __future__ import annotations

from dataclasses import dataclass

from vektorflow.physics.gpu_pipeline import GpuPhysicsPipelineSpec, gpu_physics_pipeline_spec


@dataclass(frozen=True, slots=True)
class GpuHardSphereKernelSpec:
    """Packed WebGPU hard-sphere kernel contract."""

    workgroup_size: int
    particle_stride_f32: int
    params_stride_f32: int
    pipeline: GpuPhysicsPipelineSpec
    collider_kind: str
    wgsl: str


HARD_SPHERE_PARTICLE_STRIDE_F32 = 12
HARD_SPHERE_PARAMS_STRIDE_F32 = 16
HARD_SPHERE_WORKGROUP_SIZE = 128


def hard_sphere_gpu_kernel_spec() -> GpuHardSphereKernelSpec:
    return GpuHardSphereKernelSpec(
        workgroup_size=HARD_SPHERE_WORKGROUP_SIZE,
        particle_stride_f32=HARD_SPHERE_PARTICLE_STRIDE_F32,
        params_stride_f32=HARD_SPHERE_PARAMS_STRIDE_F32,
        pipeline=gpu_physics_pipeline_spec(3, wgsl=HARD_SPHERE_GPU_WGSL),
        collider_kind="sphere_3d",
        wgsl=HARD_SPHERE_GPU_WGSL,
    )


HARD_SPHERE_GPU_WGSL = """
struct Particle {
  pos_radius: vec4<f32>,   // x, y, z, radius
  vel_density: vec4<f32>,  // vx, vy, vz, density
  mass_pad: vec4<f32>,     // mass, pad, pad, pad
};

struct Params {
  world: vec4<f32>,        // width, depth, height, restitution
  gravity: vec4<f32>,      // gx, gy, gz, dt
  grid: vec4<f32>,         // cell_size, cols, rows, layers
  sim: vec4<f32>,          // max_particles_per_cell, contact_band_ratio, particle_count, pad
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> cell_counts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> cell_items: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> collision_matrix: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> render_instances: array<vec4<f32>>;

fn particle_count() -> u32 {
  return u32(params.sim.z);
}

fn grid_cols() -> u32 {
  return u32(params.grid.y);
}

fn grid_rows() -> u32 {
  return u32(params.grid.z);
}

fn grid_layers() -> u32 {
  return u32(params.grid.w);
}

fn max_items_per_cell() -> u32 {
  return u32(params.sim.x);
}

fn cell_index_for_position(p: vec3<f32>) -> u32 {
  let cx = clamp(i32(floor(p.x / params.grid.x)), 0, i32(grid_cols()) - 1);
  let cy = clamp(i32(floor(p.y / params.grid.x)), 0, i32(grid_rows()) - 1);
  let cz = clamp(i32(floor(p.z / params.grid.x)), 0, i32(grid_layers()) - 1);
  return (u32(cz) * grid_rows() + u32(cy)) * grid_cols() + u32(cx);
}

@compute @workgroup_size(128)
fn clear_cells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let cell_count = grid_cols() * grid_rows() * grid_layers();
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
  let dt = params.gravity.w;
  let g = params.gravity.xyz;
  p.pos_radius.xyz = p.pos_radius.xyz + p.vel_density.xyz * dt + 0.5 * g * dt * dt;
  p.vel_density.xyz = p.vel_density.xyz + g * dt;

  let r = p.pos_radius.w;
  if (p.pos_radius.x < r) {
    p.pos_radius.x = r;
    p.vel_density.x = abs(p.vel_density.x) * params.world.w;
  }
  if (p.pos_radius.x > params.world.x - r) {
    p.pos_radius.x = params.world.x - r;
    p.vel_density.x = -abs(p.vel_density.x) * params.world.w;
  }
  if (p.pos_radius.y < r) {
    p.pos_radius.y = r;
    p.vel_density.y = abs(p.vel_density.y) * params.world.w;
  }
  if (p.pos_radius.y > params.world.y - r) {
    p.pos_radius.y = params.world.y - r;
    p.vel_density.y = -abs(p.vel_density.y) * params.world.w;
  }
  if (p.pos_radius.z < r) {
    p.pos_radius.z = r;
    p.vel_density.z = abs(p.vel_density.z) * params.world.w;
  }
  if (p.pos_radius.z > params.world.z - r) {
    p.pos_radius.z = params.world.z - r;
    p.vel_density.z = -abs(p.vel_density.z) * params.world.w;
  }
  particles[index] = p;
}

@compute @workgroup_size(128)
fn fill_cells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= particle_count()) {
    return;
  }
  let cell = cell_index_for_position(particles[index].pos_radius.xyz);
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
  let delta = b.pos_radius.xyz - a.pos_radius.xyz;
  let min_dist = a.pos_radius.w + b.pos_radius.w;
  let contact_band = min(a.pos_radius.w, b.pos_radius.w) * params.sim.y;
  let material = collision_matrix[0u];
  let restitution = select(params.world.w, material.x, material.w > 0.5);
  let target_dist = min_dist + contact_band;
  let dist_sq = dot(delta, delta);
  if (dist_sq >= target_dist * target_dist) {
    return;
  }
  let dist = sqrt(max(dist_sq, 1.0e-20));
  let n = select(vec3<f32>(1.0, 0.0, 0.0), delta / dist, dist_sq > 1.0e-20);
  let overlap = target_dist - select(0.0, dist, dist_sq > 1.0e-20);
  let inv_a = 1.0 / a.mass_pad.x;
  let inv_b = 1.0 / b.mass_pad.x;
  let inv_sum = inv_a + inv_b;
  let correction = overlap / inv_sum;
  a.pos_radius.xyz = a.pos_radius.xyz - n * correction * inv_a;
  b.pos_radius.xyz = b.pos_radius.xyz + n * correction * inv_b;

  let relative_normal_speed = dot(a.vel_density.xyz - b.vel_density.xyz, n);
  let desired_separation_speed = max(0.0, overlap / max(params.gravity.w, 1.0e-6));
  let bounce_speed = select(relative_normal_speed, -restitution * relative_normal_speed, relative_normal_speed > 0.0);
  let target_speed = min(-desired_separation_speed, bounce_speed);
  if (relative_normal_speed > target_speed) {
    let impulse = (relative_normal_speed - target_speed) / inv_sum;
    a.vel_density.xyz = a.vel_density.xyz - impulse * inv_a * n;
    b.vel_density.xyz = b.vel_density.xyz + impulse * inv_b * n;
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
  let base_cell = cell_index_for_position(p.pos_radius.xyz);
  let plane = grid_cols() * grid_rows();
  let cz = i32(base_cell / plane);
  let rem = base_cell - u32(cz) * plane;
  let cy = i32(rem / grid_cols());
  let cx = i32(rem % grid_cols());
  for (var oz: i32 = -1; oz <= 1; oz = oz + 1) {
    for (var oy: i32 = -1; oy <= 1; oy = oy + 1) {
      for (var ox: i32 = -1; ox <= 1; ox = ox + 1) {
        let nx = cx + ox;
        let ny = cy + oy;
        let nz = cz + oz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= i32(grid_cols()) || ny >= i32(grid_rows()) || nz >= i32(grid_layers())) {
          continue;
        }
        let cell = (u32(nz) * grid_rows() + u32(ny)) * grid_cols() + u32(nx);
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
}

fn density_color(density: f32) -> vec4<f32> {
  let t = clamp((density - 0.75) / (3.70 - 0.75), 0.0, 1.0);
  return vec4<f32>(
    0.08 + 0.88 * t,
    0.72 - 0.28 * t,
    0.92 - 0.74 * t,
    1.0
  );
}

@compute @workgroup_size(128)
fn write_render_instances(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= particle_count()) {
    return;
  }
  let p = particles[index];
  render_instances[index * 2u] = vec4<f32>(
    p.pos_radius.x - (params.world.x * 0.5),
    p.pos_radius.y - (params.world.y * 0.5),
    p.pos_radius.z - (params.world.z * 0.5),
    p.pos_radius.w
  );
  render_instances[index * 2u + 1u] = density_color(p.vel_density.w);
}
"""
