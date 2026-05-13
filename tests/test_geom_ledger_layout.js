"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "geom", "vf-geom-ledger-layout.js"),
  "utf8",
);

const window = {
  console,
  JSON,
  Date,
  SharedArrayBuffer,
  ArrayBuffer,
  Float32Array,
  Int32Array,
  Uint8Array,
  window: null,
  self: null,
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-geom-ledger-layout.js" });

assert.ok(window.VfGeomLedgerLayout);
assert.strictEqual(typeof window.VfGeomLedgerLayout.createFaceEdgeVertexStateBuffer, "function");
assert.strictEqual(typeof window.VfGeomLedgerLayout.bindFaceEdgeVertexState, "function");

const buffer = window.VfGeomLedgerLayout.createFaceEdgeVertexStateBuffer(true);
assert.ok(buffer instanceof SharedArrayBuffer);
assert.strictEqual(buffer.byteLength, window.VfGeomLedgerLayout.FACE_EDGE_VERTEX_STATE_BYTE_LENGTH);

const bound = window.VfGeomLedgerLayout.bindFaceEdgeVertexState(buffer);
bound.writeInitial(
  [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]],
  [[0, 1], [1, 2], [2, 3], [3, 0]],
);
bound.selectionFace[0] = 1;
bound.selectionEdges[1] = 1;
bound.selectionVertices[3] = 1;
bound.hoverKind[0] = 2;
bound.hoverIndex[0] = 1;
bound.lastObjectId[0] = 4;
bound.lastSimplexId[0] = 9;
bound.lastKind[0] = 2;
bound.lastIndex[0] = 1;
bound.dragActive[0] = 1;
bound.dragKind[0] = 2;
bound.dragIndex[0] = 1;
bound.dragPointerId[0] = 77;
bound.dragVertices[1] = 1;
bound.dragVertices[2] = 1;

const plain = bound.toPlainState((code) => {
  if (code === 1) return "face";
  if (code === 2) return "edge";
  if (code === 3) return "vertex";
  return "none";
});

assert.strictEqual(plain.selection.faceSelected, true);
assert.deepStrictEqual(Array.from(plain.selection.edgeSelected), [false, true, false, false]);
assert.deepStrictEqual(Array.from(plain.selection.vertexSelected), [false, false, false, true]);
assert.strictEqual(plain.hover.kind, "edge");
assert.strictEqual(plain.hover.index, 1);
assert.strictEqual(plain.lastHit.objectId, 4);
assert.strictEqual(plain.drag.active, true);
assert.deepStrictEqual(Array.from(plain.drag.vertices), [false, true, true, false]);

console.log("ok");
