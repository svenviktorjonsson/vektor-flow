const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/geom/vf-geom-wgpu.js"),
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
assert.match(source, /part\.physicsRuntime\.step\(enc,\s*dt\)/);
assert.match(source, /perfSample\.physics = this\._stepScenePhysics\(shadowEncBatch,\s*mesh,\s*t\)/);
assert.match(source, /Number\(perfSample\.physics \|\| 0\) > 0/);

console.log("vf-geom physics runtime hook tests passed");
