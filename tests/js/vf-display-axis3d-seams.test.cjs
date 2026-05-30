const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

const adapterCall = source.indexOf("createJsAxis3DProjectionKernelAdapter");
const kernelCall = source.indexOf("createProjectionKernel");

assert.ok(adapterCall >= 0, "projection adapter call missing");
assert.ok(kernelCall >= 0, "projection kernel fallback missing");
assert.ok(adapterCall < kernelCall, "adapter must be preferred before fallback kernel");

assert.ok(source.includes("function axis3DProjectionKernelDeps()"));
assert.ok(source.includes("function axis3DKernelMethod(name)"));
assert.ok(source.includes("function ensureAxis3DProjectionKernel()"));
assert.ok(source.includes("function axis3DProjectionKernelMethod(name)"));
assert.ok(source.includes("rotationCenter: axis3DRotationCenter"));
assert.ok(source.includes("projectWorldToPixel: projectWorldToPixel"));
assert.ok(source.includes("clipPixelLineToRect: clipPixelLineToRect"));
assert.ok(source.includes("cloneCamera: axis3DCloneCamera"));
assert.ok(source.includes("screenBasis: axis3DScreenBasis"));
assert.ok(source.includes("applyWorldRotation: axis3DApplyWorldRotation"));
assert.equal((source.match(/axis3DProjectionKernelDeps\(\)/g) || []).length, 3);
assert.equal((source.match(/axis3DKernelMethod\(/g) || []).length, 8);
assert.equal((source.match(/axis3DProjectionKernelMethod\(/g) || []).length, 5);
assert.equal((source.match(/typeof _vfAxis3DKernel\./g) || []).length, 0);
assert.equal((source.match(/typeof _vfAxis3DProjectionKernel\./g) || []).length, 0);

console.log("vf-display-axis3d-seams tests passed");
