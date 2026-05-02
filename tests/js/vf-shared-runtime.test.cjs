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

console.log("vf-shared-runtime tests passed");
