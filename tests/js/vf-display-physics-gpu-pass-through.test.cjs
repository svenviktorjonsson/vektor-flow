const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.match(source, /mesh\.physics_gpu = spec\.physics_gpu/);
assert.match(source, /physics_gpu:\s*spec\.physics_gpu/);
assert.match(source, /buildAnalyticPointImpostorMesh/);
assert.match(source, /instance_kind:\s*"point-impostor"/);
assert.doesNotMatch(source, /__gpuSphereInstanceMesh/);

console.log("vf-display physics_gpu pass-through tests passed");
