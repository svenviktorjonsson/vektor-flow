const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/geom/vf-geom-frame-adapter.js"),
  "utf8"
);

assert.ok(source.includes('state.lastEmittedHitKey = "";'));
assert.ok(source.includes("function pointerHitKey(req, hit)"));
assert.ok(source.includes("function samePointerHit(state, req, hit)"));
assert.ok(source.includes("function rememberPointerHit(state, req, hit)"));
assert.ok(source.includes('if (isPointerStream && samePointerHit(state, req, finalHit))'));

console.log("vf-geom-frame-adapter-hover-dedupe tests passed");
