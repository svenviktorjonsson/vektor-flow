const assert = require("node:assert/strict");
const wasmAdapterModule = require("../../web/vf-ui/vf-vkf-ui-wasm-kernel-adapter.js");
const wasmFactoryModule = require("../../web/vf-ui/vf-vkf-ui-wasm-module-factory.js");

const EXPORTS = wasmFactoryModule.EXPORT_NAMES;

{
  const memory = { buffer: new ArrayBuffer(32 * Float64Array.BYTES_PER_ELEMENT) };
  const f = new Float64Array(memory.buffer);
  const calls = [];
  const adapter = wasmAdapterModule.createWasmKernelAdapter({
    memory,
    exports: {
      [EXPORTS.rotateScaleTransform](ptr) {
        calls.push(["rotate", ptr, f[6], f[7]]);
        f[10] = f[0] + 1;
        f[11] = f[1] + 1;
        f[12] = f[2] + 1;
        f[13] = f[3] + 1;
        f[14] = f[4] + 2;
        f[15] = f[5] + 3;
      },
      [EXPORTS.scaleEdgeTransform](ptr) {
        calls.push(["scale", ptr, f[10]]);
        f[13] = f[0] + 2;
        f[14] = f[1] + 2;
        f[15] = f[2] + 2;
        f[16] = f[3] + 2;
        f[17] = f[4] + 4;
        f[18] = f[5] + 5;
      },
      [EXPORTS.moveVertexToLocalCursor](state) {
        calls.push(["moveVertex", state.vertex]);
        return { x: [9], y: [8], z: [7] };
      },
      [EXPORTS.translateEdgeVertices](state) {
        calls.push(["translateEdge", state.edge.join(",")]);
        return { x: [6], y: [5], z: [4] };
      },
      [EXPORTS.pickVertexIndex](ptr) {
        calls.push(["pickVertex", ptr, f[2]]);
        f[3 + Number(f[2]) * 3] = 2;
      },
      [EXPORTS.pickEdgeIndex](ptr) {
        calls.push(["pickEdge", ptr, f[2]]);
        f[3 + Number(f[2]) * 5] = 1;
      },
      [EXPORTS.pickFaceIndex](ptr) {
        calls.push(["pickFace", ptr, f[2]]);
        let cursor = 3;
        for (let i = 0; i < Number(f[2]); i += 1) {
          const vertexCount = Number(f[cursor]);
          cursor += 1 + vertexCount * 2;
        }
        f[cursor] = 0;
      }
    }
  });

  const rotateResult = adapter.rotateScaleTransform({
    matrix: [1, 2, 3, 4],
    offset: [5, 6],
    angle: 0.25,
    scale: 2,
    origo: [7, 8]
  });
  assert.deepEqual(rotateResult, {
    matrix: [2, 3, 4, 5],
    offset: [7, 9]
  });

  const scaleResult = adapter.scaleEdgeTransform({
    matrix: [1, 2, 3, 4],
    offset: [5, 6],
    edgeA: [10, 11],
    edgeB: [12, 13],
    scale: 3,
    origo: [14, 15]
  });
  assert.deepEqual(scaleResult, {
    matrix: [3, 4, 5, 6],
    offset: [9, 11]
  });

  assert.deepEqual(
    adapter.moveVertexToLocalCursor({ vertex: 4 }),
    { x: [9], y: [8], z: [7] }
  );
  assert.deepEqual(
    adapter.translateEdgeVertices({ edge: [1, 2] }),
    { x: [6], y: [5], z: [4] }
  );
  assert.equal(adapter.pickVertexIndex({
    point: [10, 20],
    vertices: [0, 2, 4],
    worldPoints: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]],
    vertexPickRadii: [0, 0, 6, 0, 8]
  }), 2);
  assert.equal(adapter.pickEdgeIndex({
    point: [10, 20],
    edges: [[0, 1], [1, 2]],
    worldPoints: [[1, 1], [2, 2], [3, 3]],
    edgePickRadii: [4, 7]
  }), 1);
  assert.equal(adapter.pickFaceIndex({
    point: [10, 20],
    faces: [[0, 1, 2, 3]],
    worldPoints: [[1, 1], [2, 2], [3, 3], [4, 4]]
  }), 0);

  assert.deepEqual(calls, [
    ["rotate", 0, 0.25, 2],
    ["scale", 0, 3],
    ["moveVertex", 4],
    ["translateEdge", "1,2"],
    ["pickVertex", 0, 3],
    ["pickEdge", 0, 2],
    ["pickFace", 0, 1]
  ]);
  assert.equal(typeof adapter.pickVertexIndex, "function");
}

console.log("vf-vkf-ui-wasm-kernel-adapter tests passed");
