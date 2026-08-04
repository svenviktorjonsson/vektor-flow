struct Body {
  pose_inv_mass: vec4<f32>,
  velocity_inv_inertia: vec4<f32>,
  material_radius: vec4<f32>,
  triangle_range: vec4<f32>,
}

struct Triangle {
  ab: vec4<f32>,
  c_body: vec4<f32>,
}

struct RenderSource {
  local_z_body: vec4<f32>,
  color: vec4<f32>,
}

struct Params {
  world_dt: vec4<f32>,
  gravity_counts: vec4<f32>,
  solver: vec4<f32>,
  padding: vec4<f32>,
}

struct Contact {
  normal: vec2<f32>,
  point: vec2<f32>,
  penetration: f32,
  hit: u32,
  padding: vec2<f32>,
}

@group(0) @binding(0) var<storage, read_write> bodies: array<Body>;
@group(0) @binding(1) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(2) var<storage, read> render_source: array<RenderSource>;
@group(0) @binding(3) var<storage, read_write> render_vertices: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

fn rotate2(p: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return a.x * b.y - a.y * b.x;
}

fn angular_velocity_at(omega: f32, r: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(-omega * r.y, omega * r.x);
}

fn perpendicular(r: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(-r.y, r.x);
}

// Planar generalized impulse from the paper: delta P = (delta p, delta L).
// xy is the linear impulse applied to B; z is an independent angular impulse.
fn generalized_collision_impulse(
  relative_velocity: vec2<f32>, relative_omega: f32,
  normal: vec2<f32>, r_a: vec2<f32>, r_b: vec2<f32>,
  inv_mass_a: f32, inv_mass_b: f32,
  inv_inertia_a: f32, inv_inertia_b: f32,
  restitution: f32, static_friction: f32, dynamic_friction: f32,
  rolling_friction: f32, contact_radius: f32
) -> vec3<f32> {
  let tangent = perpendicular(normal);
  let rp_a = perpendicular(r_a);
  let rp_b = perpendicular(r_b);
  let inv_mass_sum = inv_mass_a + inv_mass_b;

  // K maps delta P to the change in generalized relative contact velocity.
  let k_nn = inv_mass_sum +
    inv_inertia_a * dot(rp_a, normal) * dot(rp_a, normal) +
    inv_inertia_b * dot(rp_b, normal) * dot(rp_b, normal);
  if (k_nn <= 1.0e-10) { return vec3<f32>(0.0); }
  let normal_speed = dot(relative_velocity, normal);
  if (normal_speed >= 0.0) { return vec3<f32>(0.0); }
  let p_n = -(1.0 + restitution) * normal_speed / k_nn;

  let k_tt = inv_mass_sum +
    inv_inertia_a * dot(rp_a, tangent) * dot(rp_a, tangent) +
    inv_inertia_b * dot(rp_b, tangent) * dot(rp_b, tangent);
  let k_tn = inv_inertia_a * dot(rp_a, tangent) * dot(rp_a, normal) +
    inv_inertia_b * dot(rp_b, tangent) * dot(rp_b, normal);
  let k_tl = dot(tangent, inv_inertia_a * rp_a + inv_inertia_b * rp_b);
  let k_ln = dot(normal, inv_inertia_a * rp_a + inv_inertia_b * rp_b);
  let k_ll = inv_inertia_a + inv_inertia_b;

  // With delta p_n known, solve the coupled sticking block for
  // (delta p_t, delta L), including every off-diagonal matrix term.
  let tangent_speed = dot(relative_velocity, tangent);
  let tangent_after_normal = tangent_speed + k_tn * p_n;
  let omega_after_normal = relative_omega + k_ln * p_n;
  let determinant = k_tt * k_ll - k_tl * k_tl;
  var p_t = 0.0;
  var angular_impulse = 0.0;
  var sticks = false;
  if (determinant > 1.0e-10) {
    let rhs_t = -(1.0 + params.solver.w) * tangent_speed - k_tn * p_n;
    let rhs_l = -relative_omega - k_ln * p_n;
    let candidate_p_t = (rhs_t * k_ll - k_tl * rhs_l) / determinant;
    let candidate_l = (k_tt * rhs_l - k_tl * rhs_t) / determinant;
    sticks = abs(candidate_p_t) <= static_friction * p_n &&
      abs(candidate_l) <= static_friction * max(contact_radius, 1.0e-5) * p_n;
    if (sticks) {
      p_t = candidate_p_t;
      angular_impulse = candidate_l;
    }
  }
  if (!sticks) {
    p_t = -sign(tangent_after_normal) * dynamic_friction * p_n;
    angular_impulse = -sign(omega_after_normal) * rolling_friction *
      max(contact_radius, 1.0e-5) * p_n;
  }
  return vec3<f32>(p_n * normal + p_t * tangent, angular_impulse);
}

fn triangle_vertex(t: Triangle, index: u32) -> vec2<f32> {
  if (index == 0u) { return t.ab.xy; }
  if (index == 1u) { return t.ab.zw; }
  return t.c_body.xy;
}

fn world_triangle(t: Triangle, body: Body) -> array<vec2<f32>, 3> {
  var out: array<vec2<f32>, 3>;
  let position = body.pose_inv_mass.xy;
  let angle = body.pose_inv_mass.z;
  out[0] = position + rotate2(t.ab.xy, angle);
  out[1] = position + rotate2(t.ab.zw, angle);
  out[2] = position + rotate2(t.c_body.xy, angle);
  return out;
}

fn project_triangle(vertices: array<vec2<f32>, 3>, axis: vec2<f32>) -> vec2<f32> {
  var lo = dot(vertices[0], axis);
  var hi = lo;
  for (var i = 1u; i < 3u; i = i + 1u) {
    let value = dot(vertices[i], axis);
    lo = min(lo, value);
    hi = max(hi, value);
  }
  return vec2<f32>(lo, hi);
}

fn support(vertices: array<vec2<f32>, 3>, direction: vec2<f32>) -> vec2<f32> {
  var best = vertices[0];
  var best_projection = dot(best, direction);
  for (var i = 1u; i < 3u; i = i + 1u) {
    let candidate_projection = dot(vertices[i], direction);
    if (candidate_projection > best_projection) {
      best = vertices[i];
      best_projection = candidate_projection;
    }
  }
  return best;
}

fn triangle_centroid(vertices: array<vec2<f32>, 3>) -> vec2<f32> {
  return (vertices[0] + vertices[1] + vertices[2]) / 3.0;
}

fn triangle_contact(a: array<vec2<f32>, 3>, b: array<vec2<f32>, 3>) -> Contact {
  var result: Contact;
  result.hit = 1u;
  result.penetration = 1.0e30;
  result.normal = vec2<f32>(1.0, 0.0);
  let triangle_delta = triangle_centroid(b) - triangle_centroid(a);
  for (var shape = 0u; shape < 2u; shape = shape + 1u) {
    for (var edge = 0u; edge < 3u; edge = edge + 1u) {
      var p0 = a[edge];
      var p1 = a[(edge + 1u) % 3u];
      if (shape == 1u) {
        p0 = b[edge];
        p1 = b[(edge + 1u) % 3u];
      }
      let delta = p1 - p0;
      let length_squared = dot(delta, delta);
      if (length_squared <= 1.0e-12) { continue; }
      var axis = vec2<f32>(-delta.y, delta.x) * inverseSqrt(length_squared);
      if (dot(axis, triangle_delta) < 0.0) { axis = -axis; }
      let pa = project_triangle(a, axis);
      let pb = project_triangle(b, axis);
      let overlap = min(pa.y, pb.y) - max(pa.x, pb.x);
      if (overlap <= 0.0) {
        result.hit = 0u;
        return result;
      }
      if (overlap < result.penetration) {
        result.penetration = overlap;
        result.normal = axis;
      }
    }
  }
  let point_a = support(a, result.normal);
  let point_b = support(b, -result.normal);
  result.point = (point_a + point_b) * 0.5;
  return result;
}

fn apply_pair_impulse(index_a: u32, index_b: u32, contact: Contact) {
  var a = bodies[index_a];
  var b = bodies[index_b];
  let inv_mass_a = a.pose_inv_mass.w;
  let inv_mass_b = b.pose_inv_mass.w;
  let inv_mass_sum = inv_mass_a + inv_mass_b;
  if (inv_mass_sum <= 0.0) { return; }

  let r_a = contact.point - a.pose_inv_mass.xy;
  let r_b = contact.point - b.pose_inv_mass.xy;
  let velocity_a = a.velocity_inv_inertia.xy + angular_velocity_at(a.velocity_inv_inertia.z, r_a);
  let velocity_b = b.velocity_inv_inertia.xy + angular_velocity_at(b.velocity_inv_inertia.z, r_b);
  let generalized = generalized_collision_impulse(
    velocity_b - velocity_a, b.velocity_inv_inertia.z - a.velocity_inv_inertia.z,
    contact.normal, r_a, r_b, inv_mass_a, inv_mass_b,
    a.velocity_inv_inertia.w, b.velocity_inv_inertia.w,
    min(a.material_radius.x, b.material_radius.x),
    sqrt(a.material_radius.y * b.material_radius.y),
    sqrt(a.material_radius.z * b.material_radius.z),
    sqrt(a.triangle_range.z * b.triangle_range.z),
    min(a.triangle_range.w, b.triangle_range.w)
  );
  let linear_impulse = generalized.xy;
  let angular_impulse = generalized.z;
  a.velocity_inv_inertia.xy = a.velocity_inv_inertia.xy - linear_impulse * inv_mass_a;
  a.velocity_inv_inertia.z = a.velocity_inv_inertia.z -
    (cross2(r_a, linear_impulse) + angular_impulse) * a.velocity_inv_inertia.w;
  b.velocity_inv_inertia.xy = b.velocity_inv_inertia.xy + linear_impulse * inv_mass_b;
  b.velocity_inv_inertia.z = b.velocity_inv_inertia.z +
    (cross2(r_b, linear_impulse) + angular_impulse) * b.velocity_inv_inertia.w;

  let correction_magnitude = max(contact.penetration - params.solver.y, 0.0) *
    params.solver.x * params.padding.x / max(inv_mass_sum, 1.0e-10);
  let correction = correction_magnitude * contact.normal;
  a.pose_inv_mass.xy = a.pose_inv_mass.xy - correction * inv_mass_a;
  b.pose_inv_mass.xy = b.pose_inv_mass.xy + correction * inv_mass_b;
  bodies[index_a] = a;
  bodies[index_b] = b;
}

fn apply_wall(index: u32, point: vec2<f32>, normal: vec2<f32>, penetration: f32) {
  var body = bodies[index];
  let inv_mass = body.pose_inv_mass.w;
  if (inv_mass <= 0.0 || penetration <= 0.0) { return; }
  let r = point - body.pose_inv_mass.xy;
  let contact_velocity = body.velocity_inv_inertia.xy + angular_velocity_at(body.velocity_inv_inertia.z, r);
  let generalized = generalized_collision_impulse(
    contact_velocity, body.velocity_inv_inertia.z, normal, vec2<f32>(0.0), r,
    0.0, inv_mass, 0.0, body.velocity_inv_inertia.w,
    body.material_radius.x, body.material_radius.y, body.material_radius.z,
    body.triangle_range.z, body.triangle_range.w
  );
  body.velocity_inv_inertia.xy = body.velocity_inv_inertia.xy + generalized.xy * inv_mass;
  body.velocity_inv_inertia.z = body.velocity_inv_inertia.z +
    (cross2(r, generalized.xy) + generalized.z) * body.velocity_inv_inertia.w;
  body.pose_inv_mass.xy = body.pose_inv_mass.xy + normal *
    max(penetration - params.solver.y, 0.0) * params.solver.x * params.padding.x;
  bodies[index] = body;
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let body_count = u32(params.gravity_counts.z);
  if (index >= body_count) { return; }
  var body = bodies[index];
  if (body.pose_inv_mass.w <= 0.0) { return; }
  let dt = params.world_dt.z;
  body.velocity_inv_inertia.xy = body.velocity_inv_inertia.xy + params.gravity_counts.xy * dt;
  body.pose_inv_mass.xy = body.pose_inv_mass.xy + body.velocity_inv_inertia.xy * dt;
  body.pose_inv_mass.z = body.pose_inv_mass.z + body.velocity_inv_inertia.z * dt;
  let damping = max(0.0, 1.0 - params.solver.z * dt);
  body.velocity_inv_inertia.xy = body.velocity_inv_inertia.xy * damping;
  body.velocity_inv_inertia.z = body.velocity_inv_inertia.z * damping;
  bodies[index] = body;
}

@compute @workgroup_size(1)
fn resolve_contacts(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) { return; }
  let body_count = u32(params.gravity_counts.z);
  for (var ia = 0u; ia < body_count; ia = ia + 1u) {
    let body_a = bodies[ia];
    for (var ib = ia + 1u; ib < body_count; ib = ib + 1u) {
      let body_b = bodies[ib];
      if (body_a.pose_inv_mass.w + body_b.pose_inv_mass.w <= 0.0) { continue; }
      let center_delta = body_b.pose_inv_mass.xy - body_a.pose_inv_mass.xy;
      let radius_sum = body_a.material_radius.w + body_b.material_radius.w;
      if (dot(center_delta, center_delta) > radius_sum * radius_sum) { continue; }
      var best: Contact;
      best.hit = 0u;
      best.penetration = 1.0e30;
      let start_a = u32(body_a.triangle_range.x);
      let count_a = u32(body_a.triangle_range.y);
      let start_b = u32(body_b.triangle_range.x);
      let count_b = u32(body_b.triangle_range.y);
      for (var ta = 0u; ta < count_a; ta = ta + 1u) {
        let world_a = world_triangle(triangles[start_a + ta], body_a);
        for (var tb = 0u; tb < count_b; tb = tb + 1u) {
          let world_b = world_triangle(triangles[start_b + tb], body_b);
          let candidate = triangle_contact(world_a, world_b);
          if (candidate.hit != 0u && candidate.penetration < best.penetration) {
            best = candidate;
          }
        }
      }
      if (best.hit != 0u) {
        apply_pair_impulse(ia, ib, best);
      }
    }
  }

  let half_width = params.world_dt.x * 0.5;
  let half_height = params.world_dt.y * 0.5;
  for (var body_index = 0u; body_index < body_count; body_index = body_index + 1u) {
    let body = bodies[body_index];
    if (body.pose_inv_mass.w <= 0.0) { continue; }
    var min_x = 1.0e30;
    var max_x = -1.0e30;
    var min_y = 1.0e30;
    var max_y = -1.0e30;
    var min_x_point = vec2<f32>(0.0);
    var max_x_point = vec2<f32>(0.0);
    var min_y_point = vec2<f32>(0.0);
    var max_y_point = vec2<f32>(0.0);
    let start = u32(body.triangle_range.x);
    let count = u32(body.triangle_range.y);
    for (var tri_index = 0u; tri_index < count; tri_index = tri_index + 1u) {
      let tri = triangles[start + tri_index];
      for (var vertex_index = 0u; vertex_index < 3u; vertex_index = vertex_index + 1u) {
        let point = body.pose_inv_mass.xy + rotate2(triangle_vertex(tri, vertex_index), body.pose_inv_mass.z);
        if (point.x < min_x) { min_x = point.x; min_x_point = point; }
        if (point.x > max_x) { max_x = point.x; max_x_point = point; }
        if (point.y < min_y) { min_y = point.y; min_y_point = point; }
        if (point.y > max_y) { max_y = point.y; max_y_point = point; }
      }
    }
    apply_wall(body_index, min_x_point, vec2<f32>(1.0, 0.0), -half_width - min_x);
    apply_wall(body_index, max_x_point, vec2<f32>(-1.0, 0.0), max_x - half_width);
    apply_wall(body_index, min_y_point, vec2<f32>(0.0, 1.0), -half_height - min_y);
    apply_wall(body_index, max_y_point, vec2<f32>(0.0, -1.0), max_y - half_height);
  }
}

@compute @workgroup_size(64)
fn write_render_vertices(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let render_count = u32(params.gravity_counts.w);
  if (index >= render_count) { return; }
  let source = render_source[index];
  let body = bodies[u32(source.local_z_body.w)];
  let point = body.pose_inv_mass.xy + rotate2(source.local_z_body.xy, body.pose_inv_mass.z);
  let base = index * 10u;
  render_vertices[base + 0u] = point.x;
  render_vertices[base + 1u] = point.y;
  render_vertices[base + 2u] = source.local_z_body.z;
  render_vertices[base + 3u] = 0.0;
  render_vertices[base + 4u] = 0.0;
  render_vertices[base + 5u] = 1.0;
  render_vertices[base + 6u] = source.color.x;
  render_vertices[base + 7u] = source.color.y;
  render_vertices[base + 8u] = source.color.z;
  render_vertices[base + 9u] = source.color.w;
}
