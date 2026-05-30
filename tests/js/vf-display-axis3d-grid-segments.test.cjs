const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("function cachedVisibleAxisExtent(axisIndex)"));
assert.ok(source.includes("var extent = cachedVisibleAxisExtent(lineAxis);"));
assert.ok(source.includes("var pixel0 = projectWorldToPixel(cam, w, h, p0Grid);"));
assert.ok(source.includes("var pixel1 = projectWorldToPixel(cam, w, h, p1Grid);"));
assert.ok(source.includes("var gridClip = clipPixelSegmentToRect("));

console.log("vf-display-axis3d-grid-segments tests passed");
