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
    virtualTrackballRotate(camera, cfg, rect, prevX, prevY, curX, curY) {
      calls.push(["virtualTrackballRotate", cfg.mode, rect.width, prevX, curX]);
      camera.pos = [curX, curY, 1];
      return true;
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
  const camera = { pos: [0, 0, 0] };
  assert.equal(adapter.virtualTrackballRotate(camera, { mode: "box" }, { width: 400 }, 1, 2, 3, 4), true);
  assert.deepEqual(camera.pos, [3, 4, 1]);
  assert.deepEqual(adapter.buildCrosshairHelperLineMesh({ base: [7, 0, 0] }), {
    vertices: [1, 2, 3],
    indices: [0, 1]
  });
  assert.deepEqual(calls, [
    ["rotationCenter", "box"],
    ["cloneCamera", 4],
    ["virtualTrackballRotate", "box", 400, 1, 3],
    ["buildCrosshairHelperLineMesh", 7]
  ]);
}

console.log("vf-axis3d-kernel-adapter tests passed");
