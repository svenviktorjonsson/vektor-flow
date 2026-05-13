"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "geom", "vf-geom-wgpu.js"),
  "utf8",
);

const window = {
  console,
  JSON,
  Date,
  Float32Array,
  Uint32Array,
  ArrayBuffer,
  setTimeout,
  clearTimeout,
  window: null,
  self: null,
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-geom-wgpu.js" });

assert.ok(window.VfGeomWgpu);
assert.strictEqual(window.VfGeomWgpu.prototype._cpuPickFallback, undefined);
assert.strictEqual(window.VfGeomWgpu.prototype._buildCpuPickCache, undefined);
assert.strictEqual(window.VfGeomWgpu.prototype.containsOccupancyPixel, undefined);
assert.ok(!source.includes("resolveCpuHit"));
assert.ok(!source.includes("cpu-pick"));
assert.ok(!source.includes("cpuFallback"));
assert.ok(!source.includes("containsOccupancyPixel"));
assert.ok(!source.includes("pickAt empty"));
assert.ok(source.includes("GPU pick readback timed out"));
assert.ok(source.includes("GPU pick readback failed"));
assert.ok(source.includes("this._renderContent(now)"));
assert.ok(!source.includes("if (!this._running)"));
assert.ok(!source.includes("immediate GPU pick render failed"));
assert.ok(!source.includes("_scheduleHitMapReadback"));
assert.ok(!source.includes("_hitMap"));
assert.ok(!source.includes("_pickQueued"));
assert.ok(source.includes("caller must serialize pick requests"));

const renderer = Object.create(window.VfGeomWgpu.prototype);
assert.throws(
  () => renderer.pickAt(0, 0, () => {}),
  /pickAt called before GPU device initialization completed/,
);

const pendingRenderer = Object.create(window.VfGeomWgpu.prototype);
pendingRenderer._device = {};
pendingRenderer._pickTex = {};
pendingRenderer._pickDepthTex = {};
pendingRenderer._pickReadBuf = {};
pendingRenderer._pickPending = true;
assert.throws(
  () => pendingRenderer.pickAt(0, 0, () => {}),
  /caller must serialize pick requests/,
);

console.log("ok");
