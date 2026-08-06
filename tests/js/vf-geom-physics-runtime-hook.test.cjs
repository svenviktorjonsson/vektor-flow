const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/geom/vf-geom-wgpu.js"),
  "utf8"
);
const displaySource = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);
const polygonShader = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/shaders/vf-rigid-polygons-2d.wgsl"),
  "utf8"
);
const polygonProof = fs.readFileSync(
  path.join(__dirname, "../../examples/physics_rigid_polygons_2d.vkf"),
  "utf8"
);
const nativeStager = fs.readFileSync(
  path.join(__dirname, "../../compiler/native/vkf_native_scene_artifact_stager.cpp"),
  "utf8"
);

assert.match(source, /_createPartPhysicsRuntime:\s*function/);
assert.match(source, /_debugReadRigidPolygonBodies:/);
assert.match(source, /global\.VfGpuRuntime/);
assert.match(source, /mesh\.physics && typeof mesh\.physics === "object"/);
assert.match(source, /createHardDiscPhysicsRuntime/);
assert.match(source, /createHardSpherePhysicsRuntime/);
assert.match(source, /hard_sphere_3d/);
assert.match(source, /physicsRuntime\.renderInstanceBuffer/);
assert.match(source, /_stepScenePhysics:\s*function/);
assert.match(source, /physicsAccumulatedDt/);
assert.match(source, /part\.physicsRuntime\.step\(enc,\s*stepDt\)/);
assert.match(source, /captureSubsteps/);
assert.match(source, /part\.physicsRuntime\.step\(enc,\s*captureSubstepDt\)/);
assert.doesNotMatch(source, /part\.physicsRuntime\.step\(enc,\s*fixedDt\)/);
assert.match(source, /perfSample\.physics = this\._stepScenePhysics\(shadowEncBatch,\s*mesh,\s*t\)/);
assert.match(source, /Number\(perfSample\.physics \|\| 0\) > 0/);
assert.match(displaySource, /out\.physics_gpu = spec\.physics_gpu/);
assert.match(polygonShader, /delta P = \(delta p, delta L\)/);
assert.match(polygonShader, /generalized_collision_impulse/);
assert.match(polygonShader, /candidate_l/);
assert.match(polygonShader, /rolling_friction/);
assert.match(polygonShader, /triangle_centroid/);
assert.doesNotMatch(polygonShader, /triangle_contact\([^)]*center_delta/);
assert.match(polygonShader, /candidate\.penetration < best\.penetration/);
assert.match(polygonShader, /params\.padding\.x/);
assert.match(polygonShader, /boundary_mask/);
assert.match(polygonShader, /triangle_a\.c_body\.w/);
assert.match(polygonShader, /triangle_b\.c_body\.w/);
assert.match(polygonShader, /swept_vertex_edge_distance/);
assert.match(polygonShader, /swept_vertex_edge_toi/);
assert.match(polygonShader, /earliest_swept_event/);
assert.match(polygonShader, /swept_bounding_circles_overlap/);
assert.match(polygonShader, /closest_time = clamp/);
assert.doesNotMatch(polygonShader, /if \(dot\(delta, delta\) > radius \* radius\) \{ continue; \}/);
assert.match(polygonShader, /let normal = vec2<f32>\(edge\.y, -edge\.x\)/);
assert.doesNotMatch(polygonShader, /dot\(normal, vertex - edge_a\) < 0\.0/);
assert.match(polygonShader, /triangle_vertex\(tri_b, vertex\)[\s\S]*body_b, body_a, dt/);
assert.match(polygonShader, /let body_a = bodies\[ia\]/);
assert.doesNotMatch(polygonShader, /previous_bodies/);
assert.match(polygonShader, /for \(var iteration = 0u; iteration < 12u/);
assert.match(fs.readFileSync(path.join(__dirname, "../../web/vf-ui/vf-gpu-runtime.js"), "utf8"), /out\[12\]\s*=\s*1\.0/);
assert.match(fs.readFileSync(path.join(__dirname, "../../web/vf-ui/vf-gpu-runtime.js"), "utf8"), /readBodies/);
assert.match(nativeStager, /triangle_boundary_mask/);
assert.match(polygonProof, /mass:\s*"inf"/);
assert.match(polygonProof, /position_correction:\s*1\.0/);
assert.match(polygonProof, /penetration_slop:\s*0\.0/);

function vkfNumbers(name) {
  return Array.from(polygonProof.matchAll(new RegExp("(?:^|\\n)\\s*" + name + ":\\s*([0-9.]+)", "g")), (match) => Number(match[1]));
}

assert.ok(vkfNumbers("restitution").every((value) => value >= 0.90));
assert.ok(vkfNumbers("static_friction").every((value) => value <= 0.20));
assert.ok(vkfNumbers("dynamic_friction").every((value) => value <= 0.10));
assert.ok(vkfNumbers("rolling_friction").every((value) => value <= 0.01));
assert.ok(vkfNumbers("linear_angular_damping").every((value) => value <= 0.0002));
assert.ok(vkfNumbers("tangential_restitution").every((value) => value >= 0.80));

console.log("vf-geom physics runtime hook tests passed");
