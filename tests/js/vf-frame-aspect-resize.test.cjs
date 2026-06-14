const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.js"),
  "utf8"
);

assert.ok(source.includes("let nw = resizeState.sw + dx"));
assert.ok(source.includes("let nh = resizeState.sh + dy"));
assert.ok(source.includes("nw = Math.max(resizeState.minW, nw);"));
assert.ok(source.includes("nh = Math.max(resizeState.minH, nh);"));
assert.ok(!source.includes("lockAspect"));
assert.ok(!source.includes("resizeState.aspectRatio"));

console.log("vf-frame free resize tests passed");
