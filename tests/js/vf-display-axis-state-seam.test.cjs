const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("function createAxisTickModeStateApplier(spec)"));
assert.ok(source.includes("function invalidateAxis3DFrameCaches(fid)"));
assert.ok(source.includes("function redrawAxisFrame(fid, geomOverride)"));
assert.ok(source.includes("function setAxisGridEnabled(fid, enabled)"));
assert.ok(source.includes("function createAxisVisualStateApplier(spec)"));
assert.ok(source.includes('if (modeField && Object.prototype.hasOwnProperty.call(state, modeField)) {'));
assert.ok(source.includes('} else if (checkedField && Object.prototype.hasOwnProperty.call(state, checkedField)) {'));
assert.ok(source.includes('nextMode = state[checkedField] ? "log" : "linear";'));
assert.ok(source.includes('var hasGrid = !!(gridField && Object.prototype.hasOwnProperty.call(state, gridField));'));
assert.ok(source.includes("if (hasMode && setAxisTickMode(targets[i], axis, nextMode)) {"));
assert.ok(source.includes("if (hasGrid && setAxisGridEnabled(targets[i], !!state[gridField])) {"));
assert.ok(source.includes("invalidateAxis3DFrameCaches(fid);"));
assert.ok(source.includes("redrawAxisFrame(fid, geom);"));
assert.ok(source.includes("setAxisGridEnabled: setAxisGridEnabled"));
assert.ok(source.includes("createAxisVisualStateApplier: createAxisVisualStateApplier"));
assert.ok(source.includes("createAxisTickModeStateApplier: createAxisTickModeStateApplier"));

console.log("vf-display axis state seam tests passed");
