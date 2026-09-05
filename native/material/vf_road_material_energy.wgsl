fn vkf_road_dielectric_f0(ior: f32) -> f32 {
  let ratio = (ior - 1.0) / (ior + 1.0);
  return ratio * ratio;
}

fn vkf_road_material_white_furnace(
  aggregate_fraction: f32,
  binder_fraction: f32,
  water_coverage: f32,
  albedo: vec3<f32>,
  cosine: f32,
) -> vec4<f32> {
  let aggregate_f0 = vkf_road_dielectric_f0(1.56);
  let binder_f0 = vkf_road_dielectric_f0(1.52);
  let water_f0 = vkf_road_dielectric_f0(4.0 / 3.0);
  let dry_f0 = aggregate_fraction * aggregate_f0
    + binder_fraction * binder_f0;
  let surface_f0 = dry_f0
    + water_coverage * (water_f0 - dry_f0);
  let one_minus_cosine = 1.0 - cosine;
  let square = one_minus_cosine * one_minus_cosine;
  let fourth = square * square;
  let fifth = fourth * one_minus_cosine;
  let fresnel = surface_f0 + (1.0 - surface_f0) * fifth;
  let energy = fresnel + (vec3<f32>(1.0) - fresnel) * albedo;
  return vec4<f32>(surface_f0, energy);
}
