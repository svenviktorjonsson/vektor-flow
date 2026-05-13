"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "geom", "vf-geom-frame-adapter.js"),
  "utf8",
);

const window = {
  console,
  JSON,
  Date,
  setTimeout,
  clearTimeout,
  window: null,
  self: null,
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-geom-frame-adapter.js" });

assert.ok(window.VfGeomFrameAdapter);
assert.strictEqual(typeof window.VfGeomFrameAdapter.createAdapter, "function");
assert.strictEqual(typeof window.VfGeomFrameAdapter.createLedgerAdapter, "function");
assert.strictEqual(typeof window.VfGeomFrameAdapter.createPointerDispatch, "function");
assert.strictEqual(typeof window.VfGeomFrameAdapter.createPickArbitrator, "function");
assert.strictEqual(typeof window.VfGeomFrameAdapter.createPointerRuntime, "function");

let providerCalls = 0;
let sceneCalls = 0;

const adapter = window.VfGeomFrameAdapter.createAdapter({
  provider() {
    providerCalls += 1;
    return {
      unified_renderer: true,
      meshes: [{ id: "m1" }],
      camera: { pos: [0, 0, 1] },
      lights: [{ kind: "ambient" }],
    };
  },
  buildScene(geomSpec) {
    sceneCalls += 1;
    return {
      parts: geomSpec.meshes.slice(),
      camera: geomSpec.camera,
      lights: geomSpec.lights,
    };
  },
});

assert.strictEqual(adapter.revision(), 0);
const scene1 = adapter.currentScene();
assert.strictEqual(providerCalls, 1);
assert.strictEqual(sceneCalls, 1);
assert.deepStrictEqual(scene1.parts, [{ id: "m1" }]);
assert.strictEqual(scene1.__revision, 0);

const scene2 = adapter.currentScene();
assert.strictEqual(providerCalls, 1);
assert.strictEqual(sceneCalls, 1);
assert.strictEqual(scene2, scene1);

adapter.markDirty();
assert.strictEqual(adapter.revision(), 1);
const scene3 = adapter.currentScene();
assert.strictEqual(providerCalls, 2);
assert.strictEqual(sceneCalls, 2);
assert.notStrictEqual(scene3, scene1);
assert.strictEqual(scene3.__revision, 1);

assert.strictEqual(adapter.onHostResize(100, 50), true);
assert.strictEqual(adapter.hostSizeKey(), "100x50");
assert.strictEqual(adapter.revision(), 2);
assert.strictEqual(adapter.onHostResize(100, 50), false);
assert.strictEqual(adapter.revision(), 2);

adapter.replaceProvider(function () {
  providerCalls += 1;
  return {
    unified_renderer: true,
    meshes: [{ id: "m2" }],
    camera: null,
    lights: [],
  };
});
assert.strictEqual(adapter.revision(), 3);
const scene4 = adapter.currentScene();
assert.strictEqual(providerCalls, 3);
assert.strictEqual(sceneCalls, 3);
assert.deepStrictEqual(scene4.parts, [{ id: "m2" }]);
assert.strictEqual(scene4.__revision, 3);

let stableCalls = 0;
const stableScene = { parts: [] };
const stableAdapter = window.VfGeomFrameAdapter.createAdapter({
  provider() {
    return { unified_renderer: true, meshes: [{ id: "stable-" + String(stableCalls) }] };
  },
  buildScene(geomSpec, previousScene) {
    stableCalls += 1;
    const scene = previousScene || stableScene;
    scene.parts = geomSpec.meshes.slice();
    return scene;
  },
});

const stable1 = stableAdapter.currentScene();
assert.strictEqual(stable1, stableScene);
assert.strictEqual(stable1.__revision, 0);
stableAdapter.markDirty();
const stable2 = stableAdapter.currentScene();
assert.strictEqual(stable2, stableScene);
assert.strictEqual(stable2.__revision, 1);
assert.deepStrictEqual(stable2.parts, [{ id: "stable-1" }]);

const ledger = {
  _snapshot: { geomSpec: { meshes: [{ id: "ledger-1" }] } },
  _listeners: [],
  snapshot() { return this._snapshot; },
  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  },
  emit() {
    this._listeners.slice().forEach((listener) => listener());
  },
};
const ledgerAdapter = window.VfGeomFrameAdapter.createLedgerAdapter({
  ledger,
  selectGeomSpec(snapshot) {
    return snapshot.geomSpec;
  },
  buildScene(geomSpec) {
    return { meshes: geomSpec.meshes.slice() };
  },
});
const ledgerScene1 = ledgerAdapter.currentScene();
assert.strictEqual(ledgerScene1.meshes[0].id, "ledger-1");
ledger._snapshot = { geomSpec: { meshes: [{ id: "ledger-2" }] } };
ledger.emit();
const ledgerScene2 = ledgerAdapter.currentScene();
assert.strictEqual(ledgerScene2.meshes[0].id, "ledger-2");
ledgerAdapter.dispose();

const pointerDispatch = window.VfGeomFrameAdapter.createPointerDispatch();
const pointerState = pointerDispatch.createState();

const hoverReq = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 10,
  clientY: 20,
  mods: { ctrl: false },
  extra: {},
});
assert.strictEqual(hoverReq.seq, 1);
assert.strictEqual(pointerState.latestReq, hoverReq);
assert.strictEqual(pointerState.latestPointerReq, hoverReq);

const beginReq = pointerDispatch.beginLatest(pointerState);
assert.strictEqual(beginReq, hoverReq);
assert.strictEqual(pointerState.inFlight, true);

let outcome = pointerDispatch.resolve(pointerState, hoverReq, { object_id: 1, x: 10, y: 20 });
assert.strictEqual(outcome.action, "emit");
assert.strictEqual(outcome.hit.object_id, 1);
pointerDispatch.finish(pointerState);
assert.strictEqual(pointerState.inFlight, false);

const hoverReq2 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 11,
  clientY: 21,
  mods: {},
  extra: {},
});
pointerDispatch.beginLatest(pointerState);
outcome = pointerDispatch.resolve(pointerState, hoverReq2, {
  object_id: 0,
  x: 11,
  y: 21,
  _occupied_hint: true,
});
assert.strictEqual(outcome.action, "confirm-empty");
assert.strictEqual(outcome.hit.object_id, 0);
hoverReq2.emptyConfirmed = true;
outcome = pointerDispatch.resolve(pointerState, hoverReq2, {
  object_id: 0,
  x: 11,
  y: 21,
  _occupied_hint: true,
});
assert.strictEqual(outcome.action, "emit");
assert.strictEqual(outcome.hit.object_id, 0);
assert.strictEqual(outcome.hit.x, 11);
assert.strictEqual(outcome.hit.y, 21);
pointerDispatch.finish(pointerState);

const hoverReq3 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 12,
  clientY: 22,
  mods: {},
  extra: {},
});
pointerDispatch.beginLatest(pointerState);
outcome = pointerDispatch.resolve(pointerState, hoverReq3, {
  object_id: 0,
  x: 12,
  y: 22,
  _occupied_hint: false,
});
assert.strictEqual(outcome.action, "emit");
assert.strictEqual(outcome.hit.object_id, 0);
pointerDispatch.finish(pointerState);

const hoverReq4 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 13,
  clientY: 23,
  mods: {},
  extra: {},
});
pointerDispatch.beginLatest(pointerState);
outcome = pointerDispatch.resolve(pointerState, hoverReq4, {
  object_id: 0,
  x: 13,
  y: 23,
  _occupied_hint: false,
});
assert.strictEqual(outcome.action, "emit");
assert.strictEqual(outcome.hit.object_id, 0);
pointerDispatch.finish(pointerState);

const movingReq1 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 14,
  clientY: 24,
  mods: {},
  extra: {},
});
const movingReq2 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 15,
  clientY: 25,
  mods: {},
  extra: {},
});
assert.strictEqual(movingReq2.seq, movingReq1.seq + 1);
outcome = pointerDispatch.resolve(pointerState, movingReq1, {
  object_id: 1,
  x: 14,
  y: 24,
});
assert.strictEqual(outcome.action, "emit");
assert.strictEqual(outcome.hit.object_id, 1);

const staleEmptyReq1 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 16,
  clientY: 26,
  mods: {},
  extra: {},
});
const staleEmptyReq2 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 17,
  clientY: 27,
  mods: {},
  extra: {},
});
assert.strictEqual(staleEmptyReq2.seq, staleEmptyReq1.seq + 1);
outcome = pointerDispatch.resolve(pointerState, staleEmptyReq1, {
  object_id: 0,
  x: 16,
  y: 26,
});
assert.strictEqual(outcome.action, "stale");
assert.strictEqual(outcome.hit.object_id, 0);

pointerDispatch.resetState(pointerState);
const staleEmptyWithoutPositive1 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 18,
  clientY: 28,
  mods: {},
  extra: {},
});
const staleEmptyWithoutPositive2 = pointerDispatch.queueRequest(pointerState, {
  evtType: "hover",
  clientX: 19,
  clientY: 29,
  mods: {},
  extra: {},
});
assert.strictEqual(staleEmptyWithoutPositive2.seq, staleEmptyWithoutPositive1.seq + 1);
outcome = pointerDispatch.resolve(pointerState, staleEmptyWithoutPositive1, {
  object_id: 0,
  x: 18,
  y: 28,
});
assert.strictEqual(outcome.action, "stale");
assert.strictEqual(outcome.hit.object_id, 0);

pointerDispatch.resetState(pointerState);
assert.strictEqual(pointerState.seq, 0);
assert.strictEqual(pointerState.inFlight, false);
assert.strictEqual(pointerState.latestReq, null);
assert.strictEqual(pointerState.lastPositiveHit, null);

const pickArbitrator = window.VfGeomFrameAdapter.createPickArbitrator({
  emptyHit(frameX, frameY, fid) {
    return { frame_id: fid, x: frameX, y: frameY, object_id: 0, simplex_id: 0 };
  },
});

function makeCanvas(left, top, width, height) {
  return {
    width,
    height,
    getBoundingClientRect() {
      return { left, top, right: left + width, bottom: top + height, width, height };
    },
  };
}

async function pick(entries, clientX, clientY) {
  return await new Promise((resolve) => {
    pickArbitrator.pickFrame({
      fid: "geom_frame",
      entries,
      clientX,
      clientY,
      frameRect: { left: 10, top: 20 },
    }, resolve);
  });
}

(async function () {
  const empty = await pick([], 12, 25);
  assert.strictEqual(empty.object_id, 0);
  assert.strictEqual(empty.frame_id, "geom_frame");

  const entries = [
    {
      canvas: makeCanvas(10, 20, 100, 100),
      renderer: {
        pickAt(_x, _y, cb) { cb(2, 7); },
      },
    },
    {
      canvas: makeCanvas(10, 20, 100, 100),
      renderer: {
        pickAt(_x, _y, cb) { cb(6, 1); },
      },
    },
  ];
  const topHit = await pick(entries, 30, 45);
  assert.strictEqual(topHit.object_id, 6);
  assert.strictEqual(topHit.simplex_id, 1);
  assert.strictEqual(topHit.x, 20);
  assert.strictEqual(topHit.y, 25);

  const occupiedOnly = await pick([
    {
      canvas: makeCanvas(10, 20, 100, 100),
      renderer: {
        pickAt(_x, _y, cb) { cb(0, 0, _x, _y, { occupiedHint: true, sampleCount: 2, bestOid: 2, bestCount: 2 }); },
      },
    },
  ], 40, 60);
  assert.strictEqual(occupiedOnly.object_id, 0);
  assert.strictEqual(occupiedOnly._occupied_hint, undefined);

  const rafQueue = [];
  let emitted = [];
  const runtimeDispatch = window.VfGeomFrameAdapter.createPointerDispatch();
  const runtime = window.VfGeomFrameAdapter.createPointerRuntime({
    dispatch: runtimeDispatch,
    requestAnimationFrame(cb) {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame() {},
    performPick(req, cb) {
      if (req.clientX === 1) {
        cb({ object_id: 4, simplex_id: 2, x: 5, y: 6 });
        return;
      }
      cb({ object_id: 0, simplex_id: 0, x: 7, y: 8, _occupied_hint: false });
    },
    emit(hit, req) {
      emitted.push({ hit, req });
    },
  });

  runtime.enqueue({ evtType: "hover", clientX: 1, clientY: 2, mods: {}, extra: {} });
  assert.strictEqual(emitted.length, 0);
  assert.strictEqual(rafQueue.length, 1);
  rafQueue.shift()(1);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(emitted[0].hit.object_id, 4);
  assert.strictEqual(rafQueue.length, 0);

  runtime.enqueue({ evtType: "hover", clientX: 9, clientY: 9, mods: {}, extra: {} });
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(rafQueue.length, 1);
  rafQueue.shift()(2);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(rafQueue.length, 1);
  rafQueue.shift()(3);
  assert.strictEqual(emitted.length, 2);
  assert.strictEqual(emitted[1].hit.object_id, 0);

  runtime.enqueue({ evtType: "down", clientX: 3, clientY: 4, mods: { ctrl: true }, extra: { button: 0 } });
  assert.strictEqual(emitted.length, 3);
  assert.strictEqual(emitted[2].req.evtType, "down");

  runtime.leave({ object_id: 0, x: 0, y: 0 });
  assert.strictEqual(emitted.length, 4);
  assert.strictEqual(emitted[3].req.evtType, "leave");

  const asyncEmitted = [];
  const pendingPicks = [];
  const asyncRuntime = window.VfGeomFrameAdapter.createPointerRuntime({
    dispatch: window.VfGeomFrameAdapter.createPointerDispatch(),
    requestAnimationFrame(cb) {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame() {},
    performPick(req, cb) {
      pendingPicks.push({ req, cb });
    },
    emit(hit, req) {
      asyncEmitted.push({ hit, req });
    },
  });

  asyncRuntime.enqueue({ evtType: "hover", clientX: 100, clientY: 100, mods: {}, extra: {} });
  asyncRuntime.enqueue({ evtType: "hover", clientX: 200, clientY: 200, mods: {}, extra: {} });
  assert.strictEqual(pendingPicks.length, 0);
  assert.strictEqual(rafQueue.length, 1);
  rafQueue.shift()(3);
  assert.strictEqual(pendingPicks.length, 1);
  assert.strictEqual(pendingPicks[0].req.clientX, 200);
  pendingPicks.shift().cb({ object_id: 1, simplex_id: 0, x: 200, y: 200 });
  assert.strictEqual(asyncEmitted.length, 1);
  assert.strictEqual(asyncEmitted[0].hit.object_id, 1);
  assert.strictEqual(asyncEmitted[0].req.clientX, 200);

  asyncRuntime.enqueue({ evtType: "hover", clientX: 300, clientY: 300, mods: {}, extra: {} });
  assert.strictEqual(rafQueue.length, 1);
  rafQueue.shift()(4);
  assert.strictEqual(pendingPicks.length, 1);
  assert.strictEqual(pendingPicks[0].req.clientX, 300);
  asyncRuntime.enqueue({ evtType: "hover", clientX: 400, clientY: 400, mods: {}, extra: {} });
  assert.strictEqual(pendingPicks.length, 1);
  pendingPicks.shift().cb({ object_id: 5, simplex_id: 0, x: 300, y: 300 });
  assert.strictEqual(asyncEmitted.length, 2);
  assert.strictEqual(asyncEmitted[1].hit.object_id, 5);
  assert.strictEqual(pendingPicks.length, 1);
  assert.strictEqual(pendingPicks[0].req.clientX, 400);
  pendingPicks.shift().cb({ object_id: 0, simplex_id: 0, x: 400, y: 400 });
  assert.strictEqual(asyncEmitted.length, 2);
  assert.strictEqual(pendingPicks.length, 0);
  assert.strictEqual(rafQueue.length, 1);
  rafQueue.shift()(6);
  assert.strictEqual(pendingPicks.length, 1);
  assert.strictEqual(pendingPicks[0].req.clientX, 400);
  pendingPicks.shift().cb({ object_id: 0, simplex_id: 0, x: 400, y: 400 });
  assert.strictEqual(asyncEmitted.length, 3);
  assert.strictEqual(asyncEmitted[2].hit.object_id, 0);
  assert.strictEqual(asyncEmitted[2].req.clientX, 400);

  const flickerRaf = [];
  const flickerPending = [];
  const flickerEmitted = [];
  const flickerRuntime = window.VfGeomFrameAdapter.createPointerRuntime({
    dispatch: window.VfGeomFrameAdapter.createPointerDispatch(),
    requestAnimationFrame(cb) {
      flickerRaf.push(cb);
      return flickerRaf.length;
    },
    cancelAnimationFrame() {},
    performPick(req, cb) {
      flickerPending.push({ req, cb });
    },
    emit(hit, req) {
      flickerEmitted.push({ hit, req });
    },
  });

  flickerRuntime.enqueue({ evtType: "hover", clientX: 10, clientY: 10, mods: {}, extra: {} });
  flickerRaf.shift()(1);
  flickerPending.shift().cb({ object_id: 1, simplex_id: 0, x: 10, y: 10 });
  assert.strictEqual(flickerEmitted.length, 1);
  assert.strictEqual(flickerEmitted[0].hit.object_id, 1);

  flickerRuntime.enqueue({ evtType: "hover", clientX: 11, clientY: 10, mods: {}, extra: {} });
  flickerRaf.shift()(2);
  flickerPending.shift().cb({ object_id: 0, simplex_id: 0, x: 11, y: 10 });
  assert.strictEqual(flickerEmitted.length, 1);
  assert.strictEqual(flickerRaf.length, 1);

  flickerRuntime.enqueue({ evtType: "hover", clientX: 12, clientY: 10, mods: {}, extra: {} });
  flickerRaf.shift()(3);
  assert.strictEqual(flickerPending.length, 1);
  assert.strictEqual(flickerPending[0].req.clientX, 12);
  flickerPending.shift().cb({ object_id: 1, simplex_id: 0, x: 12, y: 10 });
  assert.strictEqual(flickerEmitted.length, 2);
  assert.strictEqual(flickerEmitted[1].hit.object_id, 1);

  console.log("ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
  return undefined;
});
