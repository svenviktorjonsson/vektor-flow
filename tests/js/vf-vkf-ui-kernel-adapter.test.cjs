const assert = require("node:assert/strict");
const adapterModule = require("../../web/vf-ui/vf-vkf-ui-kernel-adapter.js");

{
  const called = [];
  const adapter = adapterModule.createJsKernelAdapter({
    rotateScaleTransform(input) {
      called.push(["rotate", input.angle]);
      return { matrix: [1, 0, 0, 1], offset: [0, 0] };
    }
  });

  adapter.rotateScaleTransform({ angle: 2 });
  assert.deepEqual(called, [["rotate", 2]]);
  assert.equal(typeof adapter.scaleEdgeTransform, "function");
  assert.equal(typeof adapter.pickFaceIndex, "function");
}

console.log("vf-vkf-ui-kernel-adapter tests passed");
