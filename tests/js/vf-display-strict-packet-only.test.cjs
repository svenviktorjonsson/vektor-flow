const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

assert.ok(source.includes("function strictPacketOnlyEnabled()"));
assert.ok(source.includes("data-vf-runtime-strict-packet-only"));
assert.ok(source.includes("__vfRuntimeStrictPacketOnly === true"));
assert.ok(source.includes("loadAndRender: strict packet-only mode suppressed legacy display file fetch"));
assert.ok(source.indexOf("if (strictPacketOnlyEnabled())") < source.indexOf('fetch(url, { cache: "no-store" })'));

console.log("vf-display strict packet-only tests passed");
