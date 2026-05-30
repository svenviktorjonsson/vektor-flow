const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("body.__vfAxis3DWheelState = null;"));
assert.ok(source.includes("function cancelAxis3DWheelRaf(state)"));
assert.ok(source.includes("function flushAxis3DWheel()"));
assert.ok(source.includes('axis3DLogRotateDiag("nonfinite-after-wheel"'));
assert.ok(source.includes("if (body.__vfAxis3DDragState) {"));
assert.ok(source.includes("wheel.deltaY = Number(wheel.deltaY || 0) + (Number(e.deltaY) || 0);"));
assert.ok(source.includes("wheel.raf = global.requestAnimationFrame(function () {"));
assert.ok(source.includes("cancelAxis3DWheelRaf(body.__vfAxis3DWheelState);"));

console.log("vf-display-axis3d-wheel-seam tests passed");
