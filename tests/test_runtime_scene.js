"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "vf-runtime-scene.js"),
  "utf8",
);

function createClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    contains(value) {
      return values.has(value);
    },
  };
}

const postedMessages = [];
const layer = {
  children: [],
  _vfMasterTeardown: false,
  querySelectorAll(selector) {
    if (selector !== ".vf-frame") {
      return [];
    }
    return this.children.filter((child) => child.classList && child.classList.contains("vf-frame"));
  },
};

const mountedPanels = [];
const frameApi = {
  _coerceAlpha(value, fallback) {
    return value == null ? fallback : Number(value);
  },
  normalizeDockLocationKey(value) {
    return String(value || "bl");
  },
  mount(targetLayer, options) {
    const root = {
      dataset: {},
      style: {},
      classList: createClassList(),
      offsetParent: { clientWidth: 1000, clientHeight: 800, classList: { contains() { return false; } } },
      parentElement: null,
      remove() {
        const idx = targetLayer.children.indexOf(root);
        if (idx >= 0) {
          targetLayer.children.splice(idx, 1);
        }
      },
    };
    root.classList.add("vf-frame");
    targetLayer.children.push(root);
    const panel = {
      root,
      body: { children: [], appendChild() {} },
      syncPointerPassThrough() {},
      renderTitle() {},
      destroy() {
        root.remove();
        if (typeof options.onFrameRemoved === "function") {
          options.onFrameRemoved();
        }
      },
    };
    mountedPanels.push({ panel, options });
    return panel;
  },
};

const window = {
  console,
  JSON,
  Date,
  document: {},
  chrome: {
    webview: {
      postMessage(payload) {
        postedMessages.push(payload);
      },
    },
  },
  requestAnimationFrame(fn) {
    fn();
  },
  getComputedStyle() {
    return {
      paddingLeft: "0",
      paddingRight: "0",
      paddingTop: "0",
      paddingBottom: "0",
    };
  },
  window: null,
  self: null,
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-runtime-scene.js" });

const adapter = window.VfRuntimeScene.createAdapter({
  createRuntimeDependencies() {
    return { frame: frameApi, widgets: null };
  },
  getLayer() {
    return layer;
  },
});

adapter.applySceneCommands([
  {
    kind: "frame_upsert",
    payload: {
      spec: {
        id: "main",
        title: "Main",
        rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
        flags: { draggable: true, dockable: true, resizable: true, closable: true },
        alpha: 1,
        master: false,
        exit_counted: true,
      },
    },
  },
  {
    kind: "frame_upsert",
    payload: {
      spec: {
        id: "sentinel",
        title: "",
        rect: { x: 0.99, y: 0.99, w: 0.001, h: 0.001 },
        flags: { draggable: false, dockable: false, resizable: false, closable: false },
        alpha: 0,
        master: false,
        exit_counted: false,
      },
    },
  },
]);

assert.strictEqual(layer.children.length, 2);
assert.strictEqual(layer.children[0].dataset.vfExitCounted, "true");
assert.strictEqual(layer.children[1].dataset.vfExitCounted, "false");

mountedPanels[1].panel.destroy();
assert.strictEqual(postedMessages.length, 0);

mountedPanels[0].panel.destroy();
assert.strictEqual(postedMessages.length, 1);
assert.strictEqual(postedMessages[0].type, "close");

console.log("ok");
