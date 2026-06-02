const assert = require("node:assert/strict");

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.set = new Set();
  }
  add(...names) {
    names.forEach((name) => {
      if (name) this.set.add(String(name));
    });
  }
  remove(...names) {
    names.forEach((name) => this.set.delete(String(name)));
  }
  contains(name) {
    return this.set.has(String(name));
  }
  toggle(name, force) {
    const key = String(name);
    const next = force == null ? !this.set.has(key) : !!force;
    if (next) this.set.add(key);
    else this.set.delete(key);
    return next;
  }
}

class FakeStyle {
  constructor() {
    this.display = "";
  }
  setProperty(name, value) {
    this[String(name)] = String(value);
  }
  removeProperty(name) {
    delete this[String(name)];
  }
}

class FakeTextNode {
  constructor(text, document) {
    this.nodeType = 3;
    this.textContent = String(text || "");
    this.ownerDocument = document;
    this.parentNode = null;
  }
  get nextSibling() {
    if (!this.parentNode || !Array.isArray(this.parentNode.children)) return null;
    const index = this.parentNode.children.indexOf(this);
    return index >= 0 && index + 1 < this.parentNode.children.length ? this.parentNode.children[index + 1] : null;
  }
}

function walk(node, visit) {
  if (!node || !node.children) return;
  for (const child of node.children) {
    if (visit(child)) return child;
    const nested = walk(child, visit);
    if (nested) return nested;
  }
  return null;
}

function matchesSelector(node, selector) {
  if (!node || node.nodeType === 3) return false;
  if (selector === "canvas.vf-frame__draw-canvas") {
    return node.tagName === "CANVAS" && node.classList.contains("vf-frame__draw-canvas");
  }
  const frameMatch = selector.match(/^\.vf-frame\[data-vf-frame-id="([^"]+)"\]$/);
  if (frameMatch) {
    return node.classList.contains("vf-frame") && String(node.getAttribute("data-vf-frame-id") || "") === frameMatch[1];
  }
  return false;
}

class FakeElement {
  constructor(tagName, document) {
    this.nodeType = 1;
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = document;
    this.parentNode = null;
    this.children = [];
    this.style = new FakeStyle();
    this.attributes = Object.create(null);
    this.classList = new FakeClassList(this);
    this.eventListeners = Object.create(null);
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.type = "";
    this.options = [];
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.isConnected = true;
  }
  get nextSibling() {
    if (!this.parentNode || !Array.isArray(this.parentNode.children)) return null;
    const index = this.parentNode.children.indexOf(this);
    return index >= 0 && index + 1 < this.parentNode.children.length ? this.parentNode.children[index + 1] : null;
  }
  appendChild(child) {
    if (!child) return child;
    child.parentNode = this;
    this.children.push(child);
    if (this.tagName === "SELECT" && child.tagName === "OPTION") {
      this.options.push(child);
    }
    return child;
  }
  insertBefore(child, before) {
    if (!before) return this.appendChild(child);
    const index = this.children.indexOf(before);
    if (index < 0) return this.appendChild(child);
    child.parentNode = this;
    this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    if (this.tagName === "SELECT" && child.tagName === "OPTION") {
      this.options = this.children.filter((entry) => entry.tagName === "OPTION");
    }
    return child;
  }
  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }
  set innerHTML(value) {
    this.children = [];
    this.textContent = String(value || "");
  }
  get innerHTML() {
    return this.textContent;
  }
  setAttribute(name, value) {
    this.attributes[String(name)] = String(value);
  }
  getAttribute(name) {
    return this.attributes[String(name)];
  }
  addEventListener(type, handler) {
    this.eventListeners[String(type)] = handler;
  }
  querySelector(selector) {
    return walk(this, (child) => matchesSelector(child, selector));
  }
}

class FakeDocument {
  constructor() {
    this.frameRoots = [];
  }
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
  createTextNode(text) {
    return new FakeTextNode(text, this);
  }
  querySelector(selector) {
    for (const root of this.frameRoots) {
      if (matchesSelector(root, selector)) return root;
      const nested = root.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  registerFrameRoot(frameId) {
    const root = this.createElement("div");
    root.classList.add("vf-frame");
    root.setAttribute("data-vf-frame-id", String(frameId));
    this.frameRoots.push(root);
    return root;
  }
}

const document = new FakeDocument();
const windowObj = {
  document,
  setInterval() { return 1; },
  clearInterval() {},
  setTimeout(fn) { if (typeof fn === "function") fn(); return 1; },
  clearTimeout() {},
  requestAnimationFrame(fn) { if (typeof fn === "function") fn(); return 1; },
  dispatchEvent() {},
  Event: function Event(type) { this.type = type; },
  fetch() { return Promise.resolve({ ok: true, text: () => Promise.resolve("{}") }); }
};

global.window = windowObj;
global.document = document;
global.Event = windowObj.Event;
global.fetch = windowObj.fetch;
global.requestAnimationFrame = windowObj.requestAnimationFrame;
global.dispatchEvent = windowObj.dispatchEvent;
const axisTickModeCalls = [];
const vfDisplayStub = {
  redrawVisibleGeomFrames() {},
  setAxisTickMode(frameId, axis, mode) {
    axisTickModeCalls.push({ frameId: String(frameId), axis: String(axis), mode: String(mode) });
    return true;
  }
};
global.VfDisplay = vfDisplayStub;
windowObj.VfDisplay = vfDisplayStub;

require("../../web/vf-ui/vf-widgets.js");
const widgets = windowObj.VfWidgets;
assert.ok(widgets);

const panel = {
  body: document.createElement("div"),
  expandToFitContent() {}
};

["axis_panel_2d_crosshair", "axis_panel_2d_box", "axis_panel_3d_crosshair", "axis_panel_3d_box"].forEach((frameId) => {
  document.registerFrameRoot(frameId);
});

widgets.mount(panel, "axis_deck", [
  {
    id: "axis_mode_group",
    type: "button_group",
    active: "2d_crosshair",
    options: [
      { label: "2D crosshair", value: "2d_crosshair", target_frame: "axis_panel_2d_crosshair" },
      { label: "2D box", value: "2d_box", target_frame: "axis_panel_2d_box" },
      { label: "3D crosshair", value: "3d_crosshair", target_frame: "axis_panel_3d_crosshair" },
      { label: "3D box", value: "3d_box", target_frame: "axis_panel_3d_box" }
    ]
  },
  {
    id: "axis_log_x",
    type: "checkbox",
    label: "log x",
    axis: "x",
    axis_log_target_frames: [
      "axis_panel_2d_crosshair",
      "axis_panel_2d_box",
      "axis_panel_3d_crosshair",
      "axis_panel_3d_box"
    ]
  },
  {
    id: "mode_status",
    type: "label",
    text: "Active: 2D crosshair"
  }
], { type: "grid", rows: 2, cols: 12, row_heights: "max-content minmax(0, 1fr)" });

const groupRecord = widgets.widgetRecord("axis_deck", "axis_mode_group");
const labelRecord = widgets.widgetRecord("axis_deck", "mode_status");
const checkboxRecord = widgets.widgetRecord("axis_deck", "axis_log_x");

assert.equal(groupRecord.active, "2d_crosshair");
assert.equal(labelRecord.labelEl.textContent, "Active: 2D crosshair");
assert.equal(checkboxRecord.el.checked, false);
assert.equal(document.querySelector('.vf-frame[data-vf-frame-id="axis_panel_2d_crosshair"]').style.display, "");
assert.equal(document.querySelector('.vf-frame[data-vf-frame-id="axis_panel_3d_box"]').style.display, "none");

const applyAxisDeckState = widgets.composeStateAppliers([
  widgets.createButtonGroupStateApplier("axis_deck", "axis_mode_group", { activeField: "mode" }),
  widgets.createAxisLogCheckboxStateApplier("axis_deck", "axis_log_x", { checkedField: "log_x" }),
  widgets.createLabelStateApplier("axis_deck", "mode_status", { textField: "status" })
]);

applyAxisDeckState({
  mode: "3d_box",
  log_x: true,
  status: "Active: 3D box"
});

assert.equal(groupRecord.active, "3d_box");
assert.equal(checkboxRecord.el.checked, true);
assert.equal(labelRecord.labelEl.textContent, "Active: 3D box");
assert.equal(document.querySelector('.vf-frame[data-vf-frame-id="axis_panel_2d_crosshair"]').style.display, "none");
assert.equal(document.querySelector('.vf-frame[data-vf-frame-id="axis_panel_2d_box"]').style.display, "none");
assert.equal(document.querySelector('.vf-frame[data-vf-frame-id="axis_panel_3d_crosshair"]').style.display, "none");
assert.equal(document.querySelector('.vf-frame[data-vf-frame-id="axis_panel_3d_box"]').style.display, "");
assert.deepEqual(axisTickModeCalls, [
  { frameId: "axis_panel_2d_crosshair", axis: "x", mode: "log" },
  { frameId: "axis_panel_2d_box", axis: "x", mode: "log" },
  { frameId: "axis_panel_3d_crosshair", axis: "x", mode: "log" },
  { frameId: "axis_panel_3d_box", axis: "x", mode: "log" }
]);

console.log("vf-widgets compiled state tests passed");
