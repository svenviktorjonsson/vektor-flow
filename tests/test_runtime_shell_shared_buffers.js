"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "vf-runtime-shell.js"),
  "utf8",
);

const webviewHandlers = {};
const postedMessages = [];
const releasedBuffers = [];
const windowHandlers = {};

const chrome = {
  webview: {
    addEventListener(type, handler) {
      webviewHandlers[type] = handler;
    },
    postMessage(payload) {
      postedMessages.push(payload);
    },
    releaseBuffer(buffer) {
      releasedBuffers.push(buffer);
    },
  },
};

const window = {
  console,
  JSON,
  Date,
  Promise,
  URL,
  chrome,
  location: { pathname: "/sessions/ui-face-edge-vertex-drag/vkf-scene.html" },
  addEventListener(type, handler) {
    windowHandlers[type] = handler;
  },
  requestAnimationFrame() {
    throw new Error("requestAnimationFrame should not run in shared buffer bridge test");
  },
  cancelAnimationFrame() {},
  setTimeout(fn) {
    return setImmediate(fn);
  },
  setInterval() {
    return 1;
  },
  clearInterval() {},
  document: undefined,
  window: null,
  self: null,
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-runtime-shell.js" });

assert.ok(window.VfRuntimeShell);
assert.strictEqual(typeof window.VfRuntimeShell.requestSharedBuffers, "function");
assert.strictEqual(typeof window.VfRuntimeShell.waitForSharedBuffers, "function");
postedMessages.length = 0;

(async () => {
  const waitPromise = window.VfRuntimeShell.waitForSharedBuffers("scene", "geom_frame");
  window.VfRuntimeShell.requestSharedBuffers("scene", "geom_frame");
  const requestMessage = postedMessages.find((message) => message && message.type === "vf_request_shared_buffers");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(requestMessage)), {
    type: "vf_request_shared_buffers",
    channel: "scene",
    name: "geom_frame",
  });

  const headerBuffer = new ArrayBuffer(24);
  const stateBuffer = new ArrayBuffer(64);
  webviewHandlers.sharedbufferreceived({
    additionalData: {
      type: "vf_geom_ledger_shared_buffer",
      channel: "scene",
      name: "geom_frame",
      slot: "header",
      stateFormat: 1001,
    },
    getBuffer() {
      return headerBuffer;
    },
  });
  webviewHandlers.sharedbufferreceived({
    additionalData: {
      type: "vf_geom_ledger_shared_buffer",
      channel: "scene",
      name: "geom_frame",
      slot: "state",
      stateFormat: 1001,
    },
    getBuffer() {
      return stateBuffer;
    },
  });
  const result = await waitPromise;
  assert.strictEqual(result.headerBuffer, headerBuffer);
  assert.strictEqual(result.stateBuffer, stateBuffer);

  const errorPromise = window.VfRuntimeShell.waitForSharedBuffers("scene", "missing");
  webviewHandlers.message({
    data: {
      type: "vf_geom_ledger_error",
      channel: "scene",
      name: "missing",
      message: "not loaded",
    },
  });
  await assert.rejects(errorPromise, /not loaded/);

  if (windowHandlers.beforeunload) {
    windowHandlers.beforeunload();
  }
  assert.ok(releasedBuffers.includes(headerBuffer));
  assert.ok(releasedBuffers.includes(stateBuffer));
  console.log("ok");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
