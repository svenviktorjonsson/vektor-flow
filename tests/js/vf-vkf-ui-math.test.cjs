const assert = require("node:assert/strict");
const math = require("../../web/vf-ui/vf-vkf-ui-math.js");

assert.deepEqual(math.cloneVec2([3, 4]), [3, 4]);
assert.deepEqual(math.cloneVec3([3, 4, 5]), [3, 4, 5]);

assert.deepEqual(
  math.matMul2([1, 2, 3, 4], [5, 6, 7, 8]),
  [19, 22, 43, 50]
);
assert.deepEqual(math.matVec2([2, 0, 0, 3], [4, 5]), [8, 15]);
assert.equal(math.det2([2, 1, 3, 4]), 5);
assert.deepEqual(math.invert2([2, 0, 0, 4]), [0.5, 0, 0, 0.25]);

assert.deepEqual(math.add2([1, 2], [3, 4]), [4, 6]);
assert.deepEqual(math.sub2([5, 7], [2, 3]), [3, 4]);
assert.deepEqual(math.scale2([2, 3], 4), [8, 12]);
assert.equal(math.length2([3, 4]), 5);
assert.deepEqual(math.normalize2([0, 0]), [1, 0]);
assert.deepEqual(math.normalize2([0, 4]), [0, 1]);

assert.equal(
  math.pointInPolygon([2, 2], [[0, 0], [4, 0], [4, 4], [0, 4]]),
  true
);
assert.equal(
  math.pointInPolygon([5, 2], [[0, 0], [4, 0], [4, 4], [0, 4]]),
  false
);

const segment = math.distancePointToSegment([3, 2], [0, 0], [4, 0]);
assert.equal(Math.round(segment.distance * 1000) / 1000, 2);
assert.deepEqual(segment.closest, [3, 0]);

console.log("vf-vkf-ui-math tests passed");
