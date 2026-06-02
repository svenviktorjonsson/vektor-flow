const assert = require("node:assert/strict");

global.addEventListener = function () {};
const sharedDemo = require("../../web/vf-ui/vf-shared-rect-demo.js");

{
  const demo = sharedDemo.createBrowserDemo();
  assert.deepEqual(demo.getPrimaryRect(), { x: 80, y: 70, w: 220, h: 200 });
  assert.deepEqual(demo.getCompiledState(), { x: 80, y: 70, x1: 120, y1: 120, x2: 210, y2: 190 });
  assert.deepEqual(demo.getCompiledRects(), [
    { x: 80, y: 70, w: 220, h: 200 },
    { x: 120, y: 120, w: 90, h: 70 },
    { x: 210, y: 190, w: 70, h: 50 }
  ]);
  assert.equal(demo.hitTestPointer([120, 110]), true);
  assert.equal(demo.hitTestPointer([20, 20]), false);

  demo.drivePointerSample({
    pointerActive: true,
    anchor: [12, 18],
    x: 144,
    y: 167,
    down: true
  });

  assert.deepEqual(demo.getCompiledState(), { x: 132, y: 149, x1: 172, y1: 187, x2: 210, y2: 213 });
  assert.deepEqual(demo.getPrimaryRect(), { x: 132, y: 149, w: 220, h: 200 });
  assert.deepEqual(demo.getCompiledRects(), [
    { x: 132, y: 149, w: 220, h: 200 },
    { x: 172, y: 187, w: 90, h: 70 },
    { x: 210, y: 213, w: 70, h: 50 }
  ]);
  assert.equal(demo.hitTestPointer([150, 170]), true);
  assert.equal(demo.hitTestPointer([100, 100]), false);
  assert.deepEqual(demo.getLatestSnapshot(), {
    sequence: 1,
    timeMs: demo.getLatestSnapshot().timeMs,
    pointerX: 144,
    pointerY: 167,
    pointerAnchorX: 12,
    pointerAnchorY: 18,
    pointerDown: 1,
    buttons: 1,
    keyMask: 0
  });
  assert.deepEqual(demo.getLatestInput(), {
    cursorPx: [144, 167],
    pointerAnchorPx: [12, 18],
    localCursor: [0, 0],
    localAnchor: [0, 0],
    pointerDown: true,
    buttons: 1,
    keyMask: 0,
    sequence: 1,
    timeMs: demo.getLatestInput().timeMs,
    hover: { frame: -1, object: 0, face: -1, edge: -1, vertex: -1 }
  });

  const writes = demo.getWrites();
  assert.ok(writes.length >= 2, "transform writes should include initial and updated rect state");
  assert.equal(writes[writes.length - 1].offset, 0);
}

console.log("vf-shared-rect-demo compiled runtime tests passed");
