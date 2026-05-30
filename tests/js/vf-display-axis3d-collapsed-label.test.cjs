const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("function axis3DCollapsedLabelSpec(snappedOrientation)"));
assert.ok(source.includes("if (snapState.snapped && Number(snapState.snapped.axisIndex) === Number(axisIndex)) { return null; }"));
assert.ok(source.includes("var collapsedAxisLabel = axis3DCollapsedLabelSpec(snapState.snapped);"));
assert.ok(source.includes("if (collapsedAxisLabel) { axisNameLabelSpecs.push(collapsedAxisLabel); }"));

console.log("vf-display-axis3d-collapsed-label tests passed");
