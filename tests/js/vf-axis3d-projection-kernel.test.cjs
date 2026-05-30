const assert = require("node:assert/strict");
const projection = require("../../web/vf-ui/vf-axis3d-projection-kernel.js");

{
  const kernel = projection.createProjectionKernel({
    rotationCenter(cfg) {
      return cfg.mode === "box" ? [1, 2, 3] : [0, 0, 0];
    },
    projectWorldToPixel(camera, _w, _h, point) {
      var angle = (Number(camera && camera.angle) || 0) * Math.PI / 180;
      var x = Number(point[0] || 0);
      var y = Number(point[1] || 0);
      var rx = x * Math.cos(angle) - y * Math.sin(angle);
      var ry = x * Math.sin(angle) + y * Math.cos(angle);
      return [100 + rx * 10, 200 - ry * 5];
    },
    clipPixelLineToRect(a, b) {
      return [a, b];
    },
    cloneCamera(camera) {
      return { angle: Number(camera.angle) || 0 };
    },
    screenBasis() {
      return { forward: [0, 0, 1] };
    },
    applyWorldRotation(camera, _center, _axis, angleRad) {
      camera.angle = (Number(camera.angle) || 0) + angleRad * 180 / Math.PI;
    }
  });

  const info = kernel.projectedAxisInfos({}, { width: 400, height: 300 }, { mode: "box" });
  assert.deepEqual(info.center, [1, 2, 3]);
  assert.equal(info.axisInfos[0].axisIndex, 0);
  assert.ok(info.axisInfos[0].len > 0);

  const angleX = kernel.projectedAxisAngleDeg(info.axisInfos[0]);
  const angleY = kernel.projectedAxisAngleDeg(info.axisInfos[1]);
  assert.ok(Math.abs(angleX) <= 1e-6);
  assert.ok(Math.abs(Math.abs(angleY) - 90) <= 1e-6);

  const diff = kernel.projectedAxisDiffDeg({}, { width: 400, height: 300 }, { mode: "box" }, 0, 0);
  assert.ok(Math.abs(diff) <= 1e-6);

  const camera = { angle: 10 };
  const aligned = kernel.alignProjectedAxisToScreenSnap(camera, { width: 400, height: 300 }, { mode: "box" }, 0, 0);
  assert.equal(aligned, true);
  assert.notEqual(camera.angle, 10);
}

console.log("vf-axis3d-projection-kernel tests passed");
