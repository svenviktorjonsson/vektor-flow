import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

class FakeClassList {
  constructor() { this.names = new Set(); }
  add(...names) { names.forEach((name) => this.names.add(String(name))); }
  contains(name) { return this.names.has(String(name)); }
}

class FakeFragment {
  constructor() { this.nodeType = 11; this.children = []; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() { return this.children[0] || null; }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.clientWidth = 1000;
    this.clientHeight = 800;
    this.textContent = "";
  }
  appendChild(child) {
    if (child?.nodeType === 11) {
      while (child.firstChild) this.appendChild(child.removeChild(child.firstChild));
      return child;
    }
    if (child.parentNode?.removeChild) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains?.(candidate));
  }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  querySelector() { return null; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get offsetParent() { return this.parentElement; }
}

async function runtimeSandbox() {
  const sandbox = {
    document: {
      createElement: (tag) => new FakeElement(tag),
      createDocumentFragment: () => new FakeFragment(),
    },
    Element: FakeElement,
    Object,
    WeakMap,
    console,
    getComputedStyle: () => ({ paddingLeft: "0", paddingRight: "0", paddingTop: "0", paddingBottom: "0" }),
    requestAnimationFrame(callback) { callback(); },
  };
  sandbox.window = sandbox;
  for (const script of [
    "vf-html-components.js",
    "vf-runtime-packet-contract.js",
    "vf-runtime-scene.js",
    "vf-runtime-flow.js",
  ]) {
    vm.runInNewContext(await readFile(path.join(repositoryRoot, "web", "vf-ui", script), "utf8"), sandbox);
  }
  return sandbox;
}

function patchPacket(seq, ownerId, mutation) {
  return {
    seq,
    kind: "__vf_internal_html.patch",
    payload: {
      __vf_internal_retained_html_patch: {
        version: 1,
        owner: { kind: "frame", id: ownerId },
        target: 0,
        mutation,
      },
    },
  };
}

test("ordered retained patches update one Button in place without draining owner events", async () => {
  const sandbox = await runtimeSandbox();
  const layer = new FakeElement("div");
  layer.dataset.vfDisplayId = "display-0";
  let body;
  const frame = {
    _coerceAlpha: (_value, fallback) => fallback,
    normalizeDockLocationKey: () => "tl",
    mount(owner, options) {
      const root = new FakeElement("div");
      root.classList.add("vf-frame");
      root.dataset.vfFrameId = options.id;
      body = new FakeElement("div");
      const canvas = new FakeElement("canvas");
      canvas.classList.add("vf-frame__draw-canvas");
      body.appendChild(canvas);
      root.appendChild(body);
      owner.appendChild(root);
      return { root, body, setTitle() {}, setAlpha() {}, syncPointerPassThrough() {}, renderTitle() {} };
    },
  };
  const dependencies = { frame, widgets: { clearFrame() {}, refreshButtonGroups() {} } };
  const scene = sandbox.VfRuntimeScene.createAdapter({
    createRuntimeDependencies: () => dependencies,
    getLayer: () => layer,
  });
  const state = {};
  const flow = sandbox.VfRuntimeFlow.createFlow({
    config: { strictPacketOnly: true },
    createRuntimeDependencies: () => dependencies,
    applySceneCommands: scene.applySceneCommands,
    applyInternalHtmlPatchPacket: scene.applyInternalHtmlPatchPacket,
    state,
  });
  flow.routeRuntimePacket({
    seq: 1,
    kind: "scene.replace",
    payload: { commands: [{ kind: "frame_upsert", payload: { spec: {
      id: "frame-0", rect: { x: 0, y: 0, w: 1, h: 1 }, __vf_internal_html_components: ["Button"],
    } } }] },
  });
  const canvas = body.children[0];
  const button = body.children[1];
  const queues = sandbox.VfRuntimePacketContract.createInternalButtonClickedOwnerQueues({
    buttonId: "button-0", frameId: "frame-0", displayId: "display-0",
  });
  queues.consumeRuntimePacket({
    seq: 1,
    kind: "input.event",
    payload: { event: { event: "ButtonClicked", widget_id: "button-0", frame_id: "frame-0" } },
  });

  flow.routeRuntimePacket(patchPacket(2, "frame-0", { tag: 1, name: "", value: "Ready" }));
  flow.routeRuntimePacket(patchPacket(3, "frame-0", { tag: 2, name: "title", value: "Run" }));

  assert.equal(body.children[0], canvas);
  assert.equal(body.children[1], button);
  assert.equal(button.textContent, "Ready");
  assert.equal(button.getAttribute("title"), "Run");
  assert.equal(state.lastRuntimePacketSeq, 3);

  assert.throws(
    () => flow.routeRuntimePacket(patchPacket(3, "frame-0", { tag: 1, name: "", value: "Stale" })),
    /stale or invalid packet seq/,
  );
  assert.throws(
    () => flow.routeRuntimePacket(patchPacket(4, "frame-0", { tag: 2, name: "onclick", value: "unsafe()" })),
    /private retained HTML patch is malformed/,
  );
  assert.throws(
    () => flow.routeRuntimePacket(patchPacket(4, "missing-frame", { tag: 1, name: "", value: "Detached" })),
    /retained owner is unavailable/,
  );
  const unknownOwnerKind = patchPacket(4, "frame-0", { tag: 1, name: "", value: "Unknown" });
  unknownOwnerKind.payload.__vf_internal_retained_html_patch.owner.kind = "surface";
  assert.throws(
    () => flow.routeRuntimePacket(unknownOwnerKind),
    /private retained HTML patch is malformed/,
  );
  assert.equal(body.children[0], canvas);
  assert.equal(body.children[1], button);
  assert.equal(button.textContent, "Ready");
  assert.equal(button.getAttribute("title"), "Run");
  assert.equal(state.lastRuntimePacketSeq, 3);
  assert.equal(queues.button.events.get().event, "ButtonClicked");
  assert.equal(queues.frame.events.get().event, "ButtonClicked");
  assert.equal(queues.display.events.get().event, "ButtonClicked");

  flow.routeRuntimePacket(patchPacket(4, "frame-0", { tag: 2, name: "aria-label", value: "Execute" }));
  assert.equal(button.getAttribute("aria-label"), "Execute");
  assert.equal(state.lastRuntimePacketSeq, 4);
});
