const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/display-only-star-test.html"),
  "utf8",
);

assert.doesNotMatch(source, /class=["'][^"']*vf-frame(?:\s|["'])/);
assert.match(source, /id="vf-transport-star"/);
assert.match(source, /vf-alpha-hit-mask\.js/);
assert.match(source, /VfAlphaHitMask\.rasterizeSvg/);
assert.match(source, /VfFrame\.attachHeaderDrag/);
assert.match(source, /VfFrame\.postNativeHostLayout/);
assert.match(source, /dragActive: dragActive/);
assert.doesNotMatch(source, /requestAnimationFrame|setTimeout|setInterval/);
assert.doesNotMatch(source, /vf-display-only-close/);
assert.doesNotMatch(source, /intersections|sampleY|step = 2/);

console.log("vf display-only star transport tests passed");
