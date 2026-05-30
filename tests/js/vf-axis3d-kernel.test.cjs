const assert = require("node:assert/strict");
const axis3d = require("../../web/vf-ui/vf-axis3d-kernel.js");

{
  assert.deepEqual(axis3d.rotationCenter({ mode: "crosshair" }), [0, 0, 0]);
  assert.deepEqual(axis3d.rotationCenter({
    mode: "box",
    x_min: -2, x_max: 6,
    y_min: 0, y_max: 10,
    z_min: -4, z_max: 8
  }), [2, 5, 2]);
}

{
  const basis = axis3d.screenBasis({
    pos: [0, -4, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  }, [0, 0, 0]);
  assert.ok(Math.abs(basis.forward[1] - 1) <= 1e-6);
  assert.ok(Math.abs(basis.right[0] - 1) <= 1e-6);
  assert.ok(Math.abs(basis.up[2] - 1) <= 1e-6);
}

{
  const camera = {
    pos: [0, -4, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  };
  axis3d.applyWorldRotation(camera, [0, 0, 0], [0, 0, 1], Math.PI / 2);
  assert.ok(Math.abs(camera.pos[0] - 4) <= 1e-6);
  assert.ok(Math.abs(camera.pos[1]) <= 1e-6);
}

{
  const camera = axis3d.cloneCamera({
    pos: [1, 2, 3],
    target: [4, 5, 6],
    up: [0, 1, 0],
    projection: "orthographic"
  });
  assert.deepEqual(camera.pos, [1, 2, 3]);
  assert.deepEqual(camera.target, [4, 5, 6]);
  assert.deepEqual(camera.up, [0, 1, 0]);
  assert.equal(camera.projection, "orthographic");
}

{
  const camera = {
    pos: [0, -4, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  };
  const ok = axis3d.alignAxisToViewSnap(camera, { mode: "crosshair" }, 0, 1);
  assert.equal(ok, true);
  const forward = axis3d.screenBasis(camera, [0, 0, 0]).forward;
  assert.ok(Math.abs(forward[0] - 1) <= 1e-6);
}

{
  const delta = axis3d.dragWorldDelta({
    pos: [0, -4, 0],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "orthographic",
    ortho_scale: 2
  }, 200, 100, 10, 0);
  assert.ok(delta[0] < 0);
  assert.ok(Math.abs(delta[1]) <= 1e-9);
}

{
  const delta = axis3d.boxDragDataDelta({
    pos: [0, -4, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  }, 200, 100, {
    x_min: -2, x_max: 2,
    y_min: -3, y_max: 3,
    z_min: -4, z_max: 4
  }, 10, 0);
  assert.ok(delta[0] < 0);
  assert.ok(Math.abs(delta[1]) <= 1e-9);
}

console.log("vf-axis3d-kernel tests passed");
