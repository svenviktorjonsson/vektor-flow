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
  const center = axis3d.virtualTrackballPoint({ width: 400, height: 300 }, 200, 150, 20);
  assert.equal(center.inside, true);
  assert.ok(Math.abs(center.radius - 130) <= 1e-9);
  assert.deepEqual(center.point, [0, 0, 1]);
  const outside = axis3d.virtualTrackballPoint({ width: 400, height: 300 }, 400, 150, 20);
  assert.equal(outside.inside, false);
  assert.ok(Math.abs(outside.point[0] - 1) <= 1e-9);
  assert.ok(Math.abs(outside.point[1]) <= 1e-9);
  assert.ok(Math.abs(outside.point[2]) <= 1e-9);
}

{
  const camera = {
    pos: [0, -4, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  };
  const ok = axis3d.virtualTrackballRotate(
    camera,
    { mode: "crosshair" },
    { width: 400, height: 300 },
    200,
    150,
    240,
    150,
    { marginPx: 20 }
  );
  assert.equal(ok, true);
  assert.ok(camera.pos[0] > 0);
  assert.ok(Math.abs(Math.sqrt(camera.pos[0] ** 2 + camera.pos[1] ** 2 + camera.pos[2] ** 2) - 4) <= 1e-6);
}

{
  const camera = {
    pos: [0, -4, 0],
    target: [0, 0, 0],
    up: [0, 0, 1]
  };
  const ok = axis3d.virtualTrackballRotate(
    camera,
    { mode: "crosshair" },
    { width: 400, height: 300 },
    330,
    150,
    330,
    280,
    { marginPx: 20 }
  );
  assert.equal(ok, true);
  assert.ok(camera.up[0] !== 0 || camera.up[2] !== 1);
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

{
  const mesh = axis3d.buildCrosshairHelperLineMesh({
    xRange: { lo: -2, hi: 3 },
    yRange: { lo: -4, hi: 5 },
    zRange: { lo: 1, hi: 7 },
    base: [10, 20, 30],
    color: [0.1, 0.2, 0.3, 0.4]
  });
  assert.equal(mesh.vertices.length, 60);
  assert.deepEqual(mesh.indices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(mesh.vertices.slice(0, 10), [-2, 20, 30, 0, 0, 1, 0.1, 0.2, 0.3, 0.4]);
}

console.log("vf-axis3d-kernel tests passed");
