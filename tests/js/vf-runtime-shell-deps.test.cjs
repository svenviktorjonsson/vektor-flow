const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-runtime-shell.js"),
  "utf8"
);

assert.match(source, /"vf-axis3d-kernel\.js"/);
assert.match(source, /"vf-axis3d-kernel-adapter\.js"/);
assert.match(source, /"vf-axis3d-projection-kernel\.js"/);
assert.match(source, /"vf-axis3d-projection-kernel-adapter\.js"/);

const kernelIndex = source.indexOf('"vf-axis3d-kernel.js"');
const kernelAdapterIndex = source.indexOf('"vf-axis3d-kernel-adapter.js"');
const projectionIndex = source.indexOf('"vf-axis3d-projection-kernel.js"');
const projectionAdapterIndex = source.indexOf('"vf-axis3d-projection-kernel-adapter.js"');

assert.ok(kernelIndex >= 0 && kernelAdapterIndex > kernelIndex);
assert.ok(projectionIndex >= 0 && projectionAdapterIndex > projectionIndex);

console.log("vf-runtime-shell-deps tests passed");
