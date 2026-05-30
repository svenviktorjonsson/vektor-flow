const assert = require("node:assert/strict");
const kernel = require("../../web/vf-ui/vf-vkf-ui-kernel.js");

{
  const next = kernel.rotateScaleTransform({
    matrix: [1, 0, 0, 1],
    offset: [10, 20],
    angle: Math.PI / 2,
    scale: 2,
    origo: [0, 0]
  });
  assert.deepEqual(next.matrix.map((n) => Math.round(n * 1000) / 1000), [0, -2, 2, 0]);
  assert.deepEqual(next.offset.map((n) => Math.round(n)), [-40, 20]);
}

{
  const next = kernel.scaleEdgeTransform({
    matrix: [1, 0, 0, 1],
    offset: [0, 0],
    edgeA: [0, 0],
    edgeB: [4, 0],
    scale: 2,
    origo: [0, 0]
  });
  assert.deepEqual(next.matrix, [1, 0, 0, 2]);
}

{
  const moved = kernel.moveVertexToLocalCursor({
    coords: { x: [0, 1], y: [0, 1], z: [0, 0] },
    matrix: [2, 0, 0, 2],
    offset: [10, 20],
    vertex: 1,
    localCursor: [18, 30]
  });
  assert.deepEqual(moved.x, [0, 4]);
  assert.deepEqual(moved.y, [0, 5]);
}

{
  const moved = kernel.translateEdgeVertices({
    coords: { x: [0, 1, 2], y: [0, 0, 0], z: [0, 0, 0] },
    matrix: [2, 0, 0, 2],
    edge: [0, 1],
    localTrans: [4, 6]
  });
  assert.deepEqual(moved.x, [2, 3, 2]);
  assert.deepEqual(moved.y, [3, 3, 0]);
}

{
  const world = [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20]
  ];
  assert.equal(kernel.pickVertexIndex({
    point: [11, 9],
    vertices: [0, 1, 2, 3],
    worldPoint: (i) => world[i],
    vertexPickRadiusAt: () => 3
  }), 0);
  assert.equal(kernel.pickEdgeIndex({
    point: [15, 10],
    edges: [[0, 1], [1, 2]],
    worldPoint: (i) => world[i],
    edgePickRadiusAt: () => 1
  }), 0);
  assert.equal(kernel.pickFaceIndex({
    point: [15, 15],
    faces: [[0, 1, 2, 3]],
    worldPoint: (i) => world[i]
  }), 0);
}

console.log("vf-vkf-ui-kernel tests passed");
