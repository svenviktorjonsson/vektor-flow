const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

const axisKernelFactory = source.indexOf("global.VfAxis3DKernelAdapter.createJsAxis3DKernelAdapter()");
const axisKernelFallback = source.indexOf("(global.VfAxis3DKernel || null)");
assert.ok(axisKernelFactory >= 0);
assert.ok(axisKernelFallback > axisKernelFactory);

const projectionAdapterBranch = source.indexOf("createJsAxis3DProjectionKernelAdapter");
const projectionFallbackBranch = source.indexOf("createProjectionKernel");
assert.ok(projectionAdapterBranch >= 0);
assert.ok(projectionFallbackBranch > projectionAdapterBranch);

console.log("vf-display-kernel-preference tests passed");
