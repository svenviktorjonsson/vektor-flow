"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "geom", "vf-geom-ledger.js"),
  "utf8",
);
const transportSource = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "geom", "vf-geom-ledger-transport.js"),
  "utf8",
);
const layoutSource = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "geom", "vf-geom-ledger-layout.js"),
  "utf8",
);

const rafQueue = [];
const window = {
  console,
  JSON,
  Date,
  SharedArrayBuffer,
  Atomics,
  Int32Array,
  Uint8Array,
  window: null,
  self: null,
  requestAnimationFrame(cb) {
    rafQueue.push(cb);
    return rafQueue.length;
  },
  cancelAnimationFrame() {},
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-geom-ledger.js" });
vm.runInNewContext(transportSource, window, { filename: "vf-geom-ledger-transport.js" });
vm.runInNewContext(layoutSource, window, { filename: "vf-geom-ledger-layout.js" });

assert.ok(window.VfGeomLedger);
assert.strictEqual(typeof window.VfGeomLedger.createStore, "function");
assert.strictEqual(typeof window.VfGeomLedger.createTransportStore, "function");
assert.strictEqual(typeof window.VfGeomLedger.createRafPresenter, "function");
assert.strictEqual(typeof window.VfGeomLedger.createFaceEdgeVertexController, "function");
assert.strictEqual(typeof window.VfGeomLedger.createFaceEdgeVertexSharedStore, "function");
assert.ok(window.VfGeomLedgerLayout);

const store = window.VfGeomLedger.createStore({
  state: { value: 2, points: [[0.2, 0.2], [0.8, 0.8]] },
  buildSnapshot(state) {
    return {
      doubled: state.value * 2,
      pointsText: state.points.map((p) => p.join(",")).join(" | "),
    };
  },
});

assert.strictEqual(store.revision(), 0);
assert.strictEqual(store.needsPresentation(), true);
assert.deepStrictEqual(store.snapshot(), {
  doubled: 4,
  pointsText: "0.2,0.2 | 0.8,0.8",
});

const presented = [];
const presenter = window.VfGeomLedger.createRafPresenter(store, (snapshot, meta) => {
  presented.push({ snapshot, revision: meta.revision });
});

presenter.request();
assert.strictEqual(rafQueue.length, 1);
rafQueue.shift()(16);
assert.deepStrictEqual(presented[0], {
  snapshot: { doubled: 4, pointsText: "0.2,0.2 | 0.8,0.8" },
  revision: 0,
});
assert.strictEqual(store.presentedRevision(), 0);

store.mutate((state) => {
  state.value = 5;
  state.points[0] = [0.1, 0.1];
});
assert.strictEqual(store.revision(), 1);
assert.strictEqual(rafQueue.length, 1);
rafQueue.shift()(32);
assert.deepStrictEqual(presented[1], {
  snapshot: { doubled: 10, pointsText: "0.1,0.1 | 0.8,0.8" },
  revision: 1,
});

store.touch();
assert.strictEqual(store.revision(), 2);
assert.strictEqual(rafQueue.length, 1);
rafQueue.shift()(48);
assert.deepStrictEqual(presented[2], {
  snapshot: { doubled: 10, pointsText: "0.1,0.1 | 0.8,0.8" },
  revision: 2,
});

presenter.dispose();
store.touch();
assert.strictEqual(rafQueue.length, 0);

const transport = window.VfGeomLedgerTransport.createInlineTransport({
  state: { value: 3 },
  buildSnapshot(state) {
    return { tripled: state.value * 3 };
  },
});
const transportStore = window.VfGeomLedger.createTransportStore({ transport });
assert.strictEqual(transportStore.revision(), 0);
assert.deepStrictEqual(transportStore.snapshot(), { tripled: 9 });
transportStore.mutate((state) => {
  state.value = 4;
});
assert.strictEqual(transportStore.revision(), 1);
assert.deepStrictEqual(transportStore.snapshot(), { tripled: 12 });
transportStore.markPresented();
assert.strictEqual(transportStore.presentedRevision(), 1);

const sharedHeaderBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * window.VfGeomLedgerTransport.HEADER_SLOT_COUNT);
const sharedStateBuffer = window.VfGeomLedgerLayout.createFaceEdgeVertexStateBuffer(true);
const sharedHeader = new Int32Array(sharedHeaderBuffer);
const sharedBound = window.VfGeomLedgerLayout.bindFaceEdgeVertexState(sharedStateBuffer);
sharedHeader[window.VfGeomLedgerTransport.HEADER_SLOT_REVISION] = 5;
sharedHeader[window.VfGeomLedgerTransport.HEADER_SLOT_PRESENTED_REVISION] = 2;
sharedHeader[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_BYTE_LENGTH] = sharedStateBuffer.byteLength;
sharedHeader[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_FORMAT] = window.VfGeomLedgerLayout.FACE_EDGE_VERTEX_STATE_FORMAT;
sharedBound.writeInitial(
  [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]],
  [[0, 1], [1, 2], [2, 3], [3, 0]],
);
sharedBound.selectionVertices[0] = 1;
sharedBound.hoverKind[0] = 3;
sharedBound.hoverIndex[0] = 0;
const sharedTransport = window.VfGeomLedgerTransport.createSharedBufferTransport({
  headerBuffer: sharedHeaderBuffer,
  stateBuffer: sharedStateBuffer,
});
const sharedStore = window.VfGeomLedger.createTransportStore({
  transport: sharedTransport,
  buildSnapshot(stateView, header) {
    const bound = window.VfGeomLedgerLayout.bindFaceEdgeVertexState(stateView.buffer);
    return {
      firstPoint: Array.from(bound.points.slice(0, 2)),
      hoverIndex: bound.hoverIndex[0],
      vertex0Selected: !!bound.selectionVertices[0],
      revision: header.revision,
      format: header.stateFormat,
    };
  },
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(sharedStore.snapshot())), {
  firstPoint: [0.20000000298023224, 0.20000000298023224],
  hoverIndex: 0,
  vertex0Selected: true,
  revision: 5,
  format: window.VfGeomLedgerLayout.FACE_EDGE_VERTEX_STATE_FORMAT,
});
sharedStore.markPresented();
assert.strictEqual(sharedStore.presentedRevision(), 5);

const sharedFaceStore = window.VfGeomLedger.createFaceEdgeVertexSharedStore({
  points: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
  edgePairs: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
  buildSnapshot(plain, header) {
    return {
      hover: plain.hover.kind + ":" + String(plain.hover.index),
      revision: header.revision,
      firstPoint: plain.points[0],
    };
  },
});
assert.strictEqual(sharedFaceStore.transport.kind(), "shared-buffer");
assert.deepStrictEqual(JSON.parse(JSON.stringify(sharedFaceStore.snapshot())), {
  hover: "none:-1",
  revision: 0,
  firstPoint: [0.20000000298023224, 0.20000000298023224],
});
sharedFaceStore.mutate((plain) => {
  plain.hover = { kind: "face", index: 0 };
  plain.points[0] = [0.3, 0.25];
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(sharedFaceStore.snapshot())), {
  hover: "face:0",
  revision: 1,
  firstPoint: [0.30000001192092896, 0.25],
});

const hostHeaderBuffer = new ArrayBuffer(Int32Array.BYTES_PER_ELEMENT * window.VfGeomLedgerTransport.HEADER_SLOT_COUNT);
const hostStateBuffer = window.VfGeomLedgerLayout.createFaceEdgeVertexStateBuffer(false);
const hostHeader = new Int32Array(hostHeaderBuffer);
const hostBound = window.VfGeomLedgerLayout.bindFaceEdgeVertexState(hostStateBuffer);
hostBound.writeInitial(
  [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]],
  [[0, 1], [1, 2], [2, 3], [3, 0]],
);
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_REVISION] = 4;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_PRESENTED_REVISION] = 2;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_BYTE_LENGTH] = hostStateBuffer.byteLength;
hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_STATE_FORMAT] = window.VfGeomLedgerLayout.FACE_EDGE_VERTEX_STATE_FORMAT;
const hostFaceStore = window.VfGeomLedger.createFaceEdgeVertexSharedStore({
  headerBuffer: hostHeaderBuffer,
  stateBuffer: hostStateBuffer,
  points: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
  edgePairs: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
  buildSnapshot(plain, header) {
    return {
      hover: plain.hover.kind + ":" + String(plain.hover.index),
      revision: header.revision,
      firstPoint: plain.points[0],
    };
  },
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(hostFaceStore.snapshot())), {
  hover: "none:-1",
  revision: 4,
  firstPoint: [0.20000000298023224, 0.20000000298023224],
});
hostFaceStore.mutate((plain) => {
  plain.hover = { kind: "edge", index: 1 };
});
assert.strictEqual(hostHeader[window.VfGeomLedgerTransport.HEADER_SLOT_REVISION], 5);
assert.deepStrictEqual(JSON.parse(JSON.stringify(hostFaceStore.snapshot())), {
  hover: "edge:1",
  revision: 5,
  firstPoint: [0.20000000298023224, 0.20000000298023224],
});

const controller = window.VfGeomLedger.createFaceEdgeVertexController({
  points: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
  edgePairs: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
});

const vkfDrivenController = window.VfGeomLedger.createFaceEdgeVertexController({
  points: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
  edgePairs: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
  dragConfig: {
    face_vertices: [0, 1, 2, 3],
    edge_vertices: [[1, 3], [0, 2], [1, 3], [0, 2]],
    vertex_vertices: [[2], [3], [0], [1]],
    preserve_selected_on_plain_down: true,
  },
});

const state = controller.createInitialState();
assert.strictEqual(state.hover.kind, "none");
assert.strictEqual(state.hover.index, -1);
assert.deepStrictEqual(Array.from(state.drag.vertices), [false, false, false, false]);

controller.applyEvent(state, { event: "hover", object_id: 1, simplex_id: 0 });
assert.strictEqual(state.hover.kind, "face");
assert.strictEqual(state.hover.index, 0);
assert.strictEqual(state.lastHit.kind, "face");
assert.strictEqual(state.lastHit.index, 0);
assert.strictEqual(controller.overlayAlpha(state, "face", 0), 0.4);

controller.applyEvent(state, { event: "hover", object_id: 0, simplex_id: -1 });
assert.strictEqual(state.hover.kind, "none");
assert.strictEqual(state.hover.index, -1);
assert.strictEqual(state.lastHit.kind, "none");
assert.strictEqual(state.lastHit.index, -1);

controller.applyEvent(state, { event: "down", object_id: 6, simplex_id: 0, shiftKey: false, ctrlKey: false, pointerId: 7 });
assert.strictEqual(state.hover.kind, "vertex");
assert.strictEqual(state.hover.index, 0);
assert.deepStrictEqual(Array.from(state.selection.vertexSelected), [true, false, false, false]);
assert.deepStrictEqual(Array.from(state.drag.vertices), [true, false, false, false]);
assert.strictEqual(state.drag.active, true);
assert.strictEqual(state.drag.kind, "vertex");
assert.strictEqual(state.drag.pointerId, 7);
assert.strictEqual(controller.overlayAlpha(state, "vertex", 0), 0.6);

controller.applyEvent(state, { event: "drag", dx_norm: 0.1, dy_norm: -0.05 });
assert.deepStrictEqual(Array.from(state.points[0]), [0.30000000000000004, 0.15000000000000002]);

controller.applyEvent(state, { event: "up" });
assert.strictEqual(state.drag.active, false);
assert.deepStrictEqual(Array.from(state.drag.vertices), [false, false, false, false]);

const faceState = controller.createInitialState();
controller.applyEvent(faceState, { event: "down", object_id: 1, simplex_id: 0, shiftKey: false, ctrlKey: false, pointerId: 12 });
assert.strictEqual(faceState.selection.faceSelected, true);
assert.deepStrictEqual(Array.from(faceState.drag.vertices), [true, true, true, true]);
controller.applyEvent(faceState, { event: "drag", dx_norm: 0.1, dy_norm: 0.05 });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(faceState.points)),
  [
    [0.30000000000000004, 0.25],
    [0.9, 0.25],
    [0.9, 0.8500000000000001],
    [0.30000000000000004, 0.8500000000000001],
  ],
);

const edgeState = controller.createInitialState();
controller.applyEvent(edgeState, { event: "down", object_id: 2, simplex_id: 0, shiftKey: false, ctrlKey: false, pointerId: 13 });
assert.deepStrictEqual(Array.from(edgeState.selection.edgeSelected), [true, false, false, false]);
assert.deepStrictEqual(Array.from(edgeState.drag.vertices), [true, true, false, false]);
controller.applyEvent(edgeState, { event: "drag", dx_norm: 0.05, dy_norm: 0.1 });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(edgeState.points)),
  [
    [0.25, 0.30000000000000004],
    [0.8500000000000001, 0.30000000000000004],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
);

const vkfDrivenState = vkfDrivenController.createInitialState();
vkfDrivenController.applyEvent(vkfDrivenState, { event: "down", object_id: 2, simplex_id: 0, shiftKey: false, ctrlKey: false, pointerId: 21 });
assert.deepStrictEqual(Array.from(vkfDrivenState.drag.vertices), [false, true, false, true]);
vkfDrivenController.applyEvent(vkfDrivenState, { event: "up" });
vkfDrivenController.applyEvent(vkfDrivenState, { event: "down", object_id: 6, simplex_id: 0, shiftKey: false, ctrlKey: false, pointerId: 22 });
assert.deepStrictEqual(Array.from(vkfDrivenState.drag.vertices), [false, false, true, false]);

controller.applyEvent(state, { event: "down", object_id: 2, simplex_id: 0, shiftKey: true, ctrlKey: false, pointerId: 9 });
assert.deepStrictEqual(Array.from(state.selection.vertexSelected), [true, false, false, false]);
assert.deepStrictEqual(Array.from(state.selection.edgeSelected), [true, false, false, false]);
assert.strictEqual(state.drag.active, false);

controller.applyEvent(state, { event: "down", object_id: 2, simplex_id: 0, shiftKey: false, ctrlKey: false, pointerId: 14 });
assert.deepStrictEqual(Array.from(state.selection.vertexSelected), [true, false, false, false]);
assert.deepStrictEqual(Array.from(state.selection.edgeSelected), [true, false, false, false]);
assert.deepStrictEqual(Array.from(state.drag.vertices), [true, true, false, false]);
assert.strictEqual(state.drag.active, true);
controller.applyEvent(state, { event: "drag", dx_norm: 0.05, dy_norm: 0.0 });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(state.points)),
  [
    [0.35000000000000003, 0.15000000000000002],
    [0.8500000000000001, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
);

controller.applyEvent(state, { event: "down", object_id: 6, simplex_id: 0, shiftKey: false, ctrlKey: true, pointerId: 10 });
assert.deepStrictEqual(Array.from(state.selection.vertexSelected), [false, false, false, false]);
assert.deepStrictEqual(Array.from(state.selection.edgeSelected), [true, false, false, false]);

controller.applyEvent(state, { event: "down", object_id: 0, simplex_id: -1, shiftKey: false, ctrlKey: false, pointerId: 11 });
assert.strictEqual(state.selection.faceSelected, false);
assert.deepStrictEqual(Array.from(state.selection.edgeSelected), [false, false, false, false]);
assert.deepStrictEqual(Array.from(state.selection.vertexSelected), [false, false, false, false]);

const debugText = controller.buildDebugText(state);
assert.ok(debugText.includes("hover=none:-1"));
assert.ok(debugText.includes("drag.active=false"));

console.log("ok");
