const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("var _vfPointerStreamInflight = false;"));
assert.ok(source.includes("var _vfPointerStreamPending = null;"));
assert.ok(source.includes("function flushPointerStreamEventQueue(port)"));
assert.ok(source.includes('if (eventName === "hover" || eventName === "move")'));
assert.ok(source.includes("_vfPointerStreamPending = evt;"));
assert.ok(source.includes("if (_vfPointerStreamPending) {"));

console.log("vf-display-event-coalescing tests passed");
