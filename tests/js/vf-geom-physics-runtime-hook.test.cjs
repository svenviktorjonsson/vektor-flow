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

assert.match(source, /_createPartPhysicsRuntime:\s*function/);
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

console.log("vf-geom physics runtime hook tests passed");
