import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || `${command} failed without diagnostics`);
  return result.stdout;
}

class FakeFragment {
  constructor() {
    this.nodeType = 11;
    this.children = [];
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
  }
  appendChild(child) {
    if (child && child.nodeType === 11) {
      while (child.firstChild) this.appendChild(child.removeChild(child.firstChild));
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(String(name));
  }
}

async function loadBrowserRuntime() {
  const sandbox = {
    document: {
      createElement: (tag) => new FakeElement(tag),
      createDocumentFragment: () => new FakeFragment(),
    },
    Element: FakeElement,
    Map,
    Object,
    Set,
    WeakMap,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(
    await readFile(path.join(repositoryRoot, "web", "vf-ui", "vf-html-components.js"), "utf8"),
    sandbox,
  );
  return sandbox;
}

test("browser owner.get recursively unifies declarative, programmatic, and Layer ids", async () => {
  const sandbox = await loadBrowserRuntime();
  const internal = sandbox.VfHtmlComponents.__internal;
  const frame = new FakeElement("section");
  const panel = new FakeElement("div");
  panel.setAttribute("id", "panel");
  const declarative = new FakeElement("button");
  declarative.setAttribute("id", "save");
  panel.appendChild(declarative);
  frame.appendChild(panel);
  internal.adoptTree(frame, [panel, declarative]);
  const found = frame.get("save");
  assert.equal(found, declarative);
  found.disabled = true;
  assert.equal(declarative.disabled, true, "lookup must return the original retained identity");
  assert.equal(internal.get(frame, "missing"), null);

  const programmatic = new sandbox.VfHtmlComponents.Button({ id: "cancel" });
  panel.appendChild(programmatic);
  internal.adoptTree(frame, [panel, declarative, programmatic]);
  assert.equal(internal.get(frame, "cancel"), programmatic);

  const display = {};
  const layer = { id: 41, kind: "Layer" };
  internal.registerTree(display, [{ id: "frame", value: frame, children: [
    { id: "view", value: {}, children: [{ id: 41, value: layer, children: [] }] },
  ] }]);
  assert.equal(internal.get(display, 41), layer);
  assert.equal(internal.get(display, "frame"), frame);

  const duplicate = new FakeElement("button");
  duplicate.setAttribute("id", "save");
  panel.appendChild(duplicate);
  assert.throws(
    () => internal.adoptTree(frame, [panel, declarative, programmatic, duplicate]),
    /duplicate retained descendant id `save`/,
  );
  assert.equal(internal.get(frame, "save"), declarative);
});

test("native retained lookup matches recursive browser identity semantics", () => {
  const nativeTest = process.env.VKF_RETAINED_LOOKUP_NATIVE;
  assert.ok(nativeTest, "VKF_RETAINED_LOOKUP_NATIVE must name the focused native lookup test");
  run(nativeTest, []);
});
