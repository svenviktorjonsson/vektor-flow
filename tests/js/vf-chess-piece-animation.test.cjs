const assert = require("node:assert/strict");
const anim = require("../../web/vf-ui/vf-chess-piece-animation.js");

const movePlan = {
  kind: "move",
  from_x: 0.5,
  from_z: -2.5,
  to_x: 0.5,
  to_z: -0.5,
  lift: 0.35,
  duration_ms: 280,
  easing: "smoothstep",
  capture_at_ms: 0
};

assert.deepEqual(anim.samplePlan(movePlan, 0), {
  kind: "move",
  done: false,
  progress: 0,
  eased: 0,
  x: 0.5,
  y: 0,
  z: -2.5,
  hideCaptured: false
});

const mid = anim.samplePlan(movePlan, 140);
assert.equal(mid.kind, "move");
assert.equal(mid.done, false);
assert.equal(mid.x, 0.5);
assert.equal(mid.z, -1.5);
assert.ok(mid.y > 0.34 && mid.y <= 0.35);

const end = anim.samplePlan(movePlan, 280);
assert.equal(end.done, true);
assert.equal(end.x, 0.5);
assert.equal(end.y, 0);
assert.equal(end.z, -0.5);

const capture = anim.samplePlan({
  kind: "capture",
  from_x: 0.5,
  from_z: -0.5,
  to_x: -0.5,
  to_z: 0.5,
  lift: 0.55,
  duration_ms: 360,
  easing: "smoothstep",
  capture_at_ms: 180
}, 180);

assert.equal(capture.kind, "capture");
assert.equal(capture.hideCaptured, true);
assert.equal(capture.x, 0);
assert.equal(capture.z, 0);
assert.ok(capture.y > 0.54 && capture.y <= 0.55);

const frames = [];
let queued = [];
const controller = anim.createAnimator(
  movePlan,
  {
    onFrame(sample) { frames.push(sample); },
    onDone(sample) { frames.push({ doneCallback: sample.done }); }
  },
  {
    now() { return 0; },
    requestAnimationFrame(fn) { queued.push(fn); return queued.length; }
  }
);

assert.equal(typeof controller.cancel, "function");
while (queued.length) {
  const fn = queued.shift();
  fn(frames.length === 0 ? 0 : 280);
}

assert.equal(frames.at(-1).doneCallback, true);
