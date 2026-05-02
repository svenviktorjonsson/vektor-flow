const assert = require("node:assert/strict");
const runtime = require("../../web/vf-ui/vf-shared-runtime.js");

const arena = runtime.createTransformArena(4);

assert.equal(arena.capacity(), 4);
assert.equal(arena.mat4[0], 1);
assert.equal(arena.mat4[5], 1);
assert.equal(arena.mat4[10], 1);
assert.equal(arena.mat4[15], 1);

arena.setTranslate2D(2, 0.25, 0.5);

let dirty = arena.dirtyRange();
assert.equal(dirty.min, 2);
assert.equal(dirty.max, 2);
assert.equal(arena.mat4[2 * runtime.MAT4_F32 + 12], 0.25);
assert.equal(arena.mat4[2 * runtime.MAT4_F32 + 13], 0.5);

const copied = arena.copyDirtyMat4();
assert.equal(copied.range.min, 2);
assert.equal(copied.range.max, 2);
assert.equal(copied.data.length, runtime.MAT4_F32);
assert.equal(copied.data[12], 0.25);
assert.equal(copied.data[13], 0.5);

dirty = arena.dirtyRange();
assert.equal(dirty.min, -1);
assert.equal(dirty.max, -1);

arena.setTranslate2D(1, 1, 2);
arena.setTranslate2D(3, 3, 4);
dirty = arena.dirtyRange();
assert.equal(dirty.min, 1);
assert.equal(dirty.max, 3);

const dragArena = runtime.createTransformArena(1);
const rendererView = dragArena.rendererView();

dragArena.setAnchoredTranslate2D(0, 30, 40, 4, 7);

assert.equal(rendererView.capacity, 1);
assert.equal(rendererView.buffer, dragArena.buffer);
const dragCopy = rendererView.copyDirtyMat4();
assert.equal(dragCopy.range.min, 0);
assert.equal(dragCopy.range.max, 0);
assert.equal(dragCopy.data.length, runtime.MAT4_F32);
assert.equal(dragCopy.data[12], 26);
assert.equal(dragCopy.data[13], 33);
assert.deepEqual(rendererView.consumeDirtyRange(), {
  version: dragCopy.range.version,
  min: -1,
  max: -1
});

const events = runtime.createEventArena(2);
const eventReader = events.readerView();

events.writeInputSample({
  cursorPx: [120.5, 80.25],
  pointerAnchorPx: [12.5, 8.25],
  pointerDown: true,
  buttons: 1,
  keyMask: 5,
  sequence: 42,
  timeMs: 1234.5,
  hover: {
    frame: 7,
    object: 8,
    face: 9,
    edge: 10,
    vertex: 11
  }
});

assert.equal(events.capacity(), 2);
assert.equal(eventReader.buffer, events.buffer);
assert.ok(eventReader.f64 instanceof Float64Array);
assert.ok(eventReader.i32 instanceof Int32Array);
assert.deepEqual(eventReader.latestSample(), {
  cursorPx: [120.5, 80.25],
  pointerAnchorPx: [12.5, 8.25],
  pointerDown: true,
  buttons: 1,
  keyMask: 5,
  sequence: 42,
  timeMs: 1234.5,
  hover: {
    frame: 7,
    object: 8,
    face: 9,
    edge: 10,
    vertex: 11
  }
});

console.log("vf-shared-runtime tests passed");
