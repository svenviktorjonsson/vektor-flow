const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

const axis2dKernel = source.indexOf("var _vfAxis2DTicks = global.VfAxis2DTicks || null;");
const axis3dKernel = source.indexOf("var _vfAxis3DKernel = global.VfAxis3DKernelAdapter");
assert.ok(axis2dKernel >= 0, "axis2d module seam missing");
assert.ok(axis3dKernel > axis2dKernel, "axis2d module should be initialized near other seams");

assert.ok(source.includes("function axis2DTicksMethod(name)"));
assert.ok(source.includes("function buildAxisBoxTickState(spec)"));
assert.ok(source.includes("function buildAxisCrosshairTickState(spec)"));
assert.ok(source.includes("function computeAxisCrosshairRenderState(mesh, cfg, w, h)"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"buildAxisBoxTickState\");"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"buildAxisCrosshairTickState\");"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"chooseAxisTickStep\");"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"chooseReadableLinearTickStep\");"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"axisTickValuesForMode\");"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"axisCrosshairTickValuesForMode\");"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"axisValueToUnit\");"));
assert.ok(source.includes("var external = axis2DTicksMethod(\"axisUnitToValue\");"));
assert.ok(source.includes("cfg.__frozen_box_tick_state = buildAxisBoxTickState("));
assert.ok(source.includes("var state = computeAxisCrosshairRenderState(mesh, cfg, w, h);"));
assert.equal((source.match(/axis2DTicksMethod\(/g) || []).length >= 10, true);

console.log("vf-display-axis2d-seams tests passed");
