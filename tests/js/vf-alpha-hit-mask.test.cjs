const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-alpha-hit-mask.js"),
  "utf8",
);
const context = {};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "vf-alpha-hit-mask.js" });

const alpha = [
  0, 0, 255, 0, 0,
  0, 255, 255, 255, 0,
  255, 255, 0, 255, 255,
];
const data = new Uint8ClampedArray(alpha.length * 4);
for (let i = 0; i < alpha.length; i += 1) data[i * 4 + 3] = alpha[i];

const regions = context.VfAlphaHitMask.fromImageData(
  { width: 5, height: 3, data },
  { alphaThreshold: 0 },
);
assert.deepEqual(JSON.parse(JSON.stringify(regions)), [
  { left: 2, top: 0, right: 3, bottom: 1 },
  { left: 1, top: 1, right: 4, bottom: 2 },
  { left: 0, top: 2, right: 2, bottom: 3 },
  { left: 3, top: 2, right: 5, bottom: 3 },
]);
assert.equal(
  regions.some((region) => region.top <= 2 && region.bottom > 2 && region.left <= 2 && region.right > 2),
  false,
  "a fully transparent hole must stay click-through",
);

console.log("vf alpha hit-mask tests passed");
