const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.match(source, /function geomSpecNeedsUnifiedRenderer\(spec\)/);
assert.match(source, /renderableSpecs\.some\(geomSpecNeedsUnifiedRenderer\)/);
assert.match(source, /renderMode === "marker_impostor"/);

console.log("vf-display instanced mesh routing tests passed");
