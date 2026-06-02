const assert = require("node:assert/strict");
const adapterModule = require("../../web/vf-ui/vf-axis3d-kernel-adapter.js");

{
  const calls = [];
  const adapter = adapterModule.createJsAxis3DKernelAdapter({
    rotationCenter(cfg) {
      calls.push(["rotationCenter", cfg.mode]);
      return [1, 2, 3];
    },
    cloneCamera(camera) {
      calls.push(["cloneCamera", camera.pos[0]]);
      return { pos: [9, 8, 7], target: [0, 0, 0], up: [0, 0, 1] };
    },
    buildCrosshairHelperLineMesh(spec) {
      calls.push(["buildCrosshairHelperLineMesh", spec.base[0]]);
      return { vertices: [1, 2, 3], indices: [0, 1] };
    }
  });

  assert.deepEqual(adapter.rotationCenter({ mode: "box" }), [1, 2, 3]);
  assert.deepEqual(adapter.cloneCamera({ pos: [4, 5, 6] }), {
    pos: [9, 8, 7],
    target: [0, 0, 0],
    up: [0, 0, 1]
  });
  assert.deepEqual(adapter.buildCrosshairHelperLineMesh({ base: [7, 0, 0] }), {
    vertices: [1, 2, 3],
    indices: [0, 1]
  });
  assert.deepEqual(calls, [
    ["rotationCenter", "box"],
    ["cloneCamera", 4],
    ["buildCrosshairHelperLineMesh", 7]
  ]);
}

console.log("vf-axis3d-kernel-adapter tests passed");
