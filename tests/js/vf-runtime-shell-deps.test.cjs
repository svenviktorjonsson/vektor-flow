const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-runtime-shell.js"),
  "utf8"
);

assert.match(source, /"vf-axis3d-kernel\.js"/);
assert.match(source, /"vf-gpu-runtime\.js"/);
assert.match(source, /"vf-axis3d-kernel-adapter\.js"/);
assert.match(source, /"vf-axis3d-projection-kernel\.js"/);
assert.match(source, /"vf-axis3d-projection-kernel-adapter\.js"/);

const kernelIndex = source.indexOf('"vf-axis3d-kernel.js"');
const gpuRuntimeIndex = source.indexOf('"vf-gpu-runtime.js"');
const geomRuntimeIndex = source.indexOf('"geom/vf-geom-wgpu.js"');
const kernelAdapterIndex = source.indexOf('"vf-axis3d-kernel-adapter.js"');
const projectionIndex = source.indexOf('"vf-axis3d-projection-kernel.js"');
const projectionAdapterIndex = source.indexOf('"vf-axis3d-projection-kernel-adapter.js"');

assert.ok(kernelIndex >= 0 && kernelAdapterIndex > kernelIndex);
assert.ok(gpuRuntimeIndex >= 0 && geomRuntimeIndex > gpuRuntimeIndex);
assert.ok(projectionIndex >= 0 && projectionAdapterIndex > projectionIndex);
assert.match(source, /packetOnly:\s*false/);
assert.match(source, /strictPacketOnly:\s*false/);
assert.match(source, /function applySceneRuntimeConfigFromBody/);
assert.match(source, /data-vf-runtime-packet-only/);
assert.match(source, /data-vf-runtime-strict-packet-only/);
assert.match(source, /DEFAULT_RUNTIME_CONFIG\.strictPacketOnly = true/);
assert.match(source, /__vfRuntimeStrictPacketOnly = true/);
assert.match(source, /strict packet-only mode skipped legacy fallback bootstrap/);
assert.match(source, /state\.strictPacketSourceFailed = true/);
assert.match(source, /boot: strict packet-only runtime packet source failed/);
assert.match(source, /schedulePacketPoll: strict packet-only runtime packet source failed/);
assert.match(source, /strict packet-only runtime packet source failed: runtime flow unavailable/);
assert.match(source, /strict packet-only scene delivery failed: scene adapter unavailable/);
assert.match(source, /strict packet-only runtime packet routing failed: runtime flow unavailable/);
assert.match(source, /strict packet-only runtime payload delivery failed: runtime flow unavailable/);

console.log("vf-runtime-shell-deps tests passed");
