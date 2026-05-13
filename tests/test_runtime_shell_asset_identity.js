"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "web", "vf-ui", "vf-runtime-shell.js"),
  "utf8",
);

const appended = [];

function makeElement(tagName) {
  const attrs = {};
  const listeners = {};
  return {
    tagName,
    rel: "",
    href: "",
    src: "",
    async: true,
    readyState: "",
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : "";
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    __fire(type) {
      if (listeners[type]) {
        listeners[type]();
      }
    },
  };
}

const currentScript = makeElement("script");
currentScript.src = "http://127.0.0.1:51234/sessions/ui/vf-runtime-shell.js?v=123456";

const document = {
  baseURI: "http://127.0.0.1:51234/sessions/ui/vkf-scene.html",
  currentScript,
  readyState: "loading",
  body: {
    getAttribute() {
      return "";
    },
    appendChild(element) {
      appended.push(element);
      setImmediate(() => element.__fire("load"));
      return element;
    },
  },
  head: {
    appendChild(element) {
      appended.push(element);
      setImmediate(() => element.__fire("load"));
      return element;
    },
  },
  documentElement: {
    appendChild(element) {
      appended.push(element);
      setImmediate(() => element.__fire("load"));
      return element;
    },
    getAttribute() {
      return "";
    },
    setAttribute() {},
  },
  createElement: makeElement,
  getElementsByTagName() {
    return [];
  },
  addEventListener() {},
};

const window = {
  console,
  JSON,
  Date,
  Promise,
  URL,
  document,
  location: { pathname: "/not-a-scene.html" },
  addEventListener() {},
  setTimeout,
  setInterval() {
    return 1;
  },
  clearInterval() {},
  requestAnimationFrame() {
    return 1;
  },
  cancelAnimationFrame() {},
  window: null,
  self: null,
};
window.window = window;
window.self = window;

vm.runInNewContext(source, window, { filename: "vf-runtime-shell.js" });

assert.strictEqual(window.VfRuntimeShell.runtimeAssetVersion, "123456");
assert.strictEqual(window.VfRuntimeShell.config.runtimeAssetVersion, "123456");
assert.strictEqual(window.__vfRuntimeAssetVersion, "123456");
assert.strictEqual(
  window.VfRuntimeShell.resolveAssetUrl("geom/vf-geom-frame-adapter.js"),
  "http://127.0.0.1:51234/sessions/ui/geom/vf-geom-frame-adapter.js?v=123456",
);

(async () => {
  await window.VfRuntimeShell.ensureScriptLoaded("geom/vf-geom-frame-adapter.js");
  assert.strictEqual(appended.length, 1);
  assert.strictEqual(
    appended[0].src,
    "http://127.0.0.1:51234/sessions/ui/geom/vf-geom-frame-adapter.js?v=123456",
  );
  assert.strictEqual(appended[0].getAttribute("data-vf-runtime-version"), "123456");
  assert.strictEqual(appended[0].getAttribute("data-vf-runtime-ready"), "true");
  console.log("ok");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
