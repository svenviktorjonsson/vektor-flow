const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-frame.js"),
  "utf8",
);
const context = { console };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "vf-frame.js" });

const bounds = context.VfFrame.headerDragBounds({
  layerWidth: 800,
  layerHeight: 600,
  frameWidth: 400,
  frameHeight: 300,
  headerHeight: 32,
  padLeft: 0,
  padRight: 0,
  padTop: 0,
  padBottom: 0,
});

assert.deepEqual(
  JSON.parse(JSON.stringify(bounds)),
  { minLeft: -336, maxLeft: 736, minTop: 0, maxTop: 568 },
);
console.log("vf-frame offscreen drag bounds tests passed");
