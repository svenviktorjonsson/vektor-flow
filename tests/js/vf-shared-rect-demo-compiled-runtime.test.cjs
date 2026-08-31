const assert = require("node:assert/strict");

global.addEventListener = function () {};
const sharedDemo = require("../../web/vf-ui/vf-shared-rect-demo.js");

assert.throws(
  () => sharedDemo.createBrowserDemo(),
  /compiler-emitted artifact/,
  "the browser demo must not fall back to handwritten runtime bytes"
);

console.log("vf-shared-rect-demo compiler artifact requirement tests passed");
