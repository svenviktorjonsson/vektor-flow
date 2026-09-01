const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8",
);

const globalListeners = new Map();
const documentListeners = new Map();
const dispatchedEvents = [];

function listen(registry, type, listener) {
  if (!registry.has(type)) {
    registry.set(type, []);
  }
  registry.get(type).push(listener);
}

function emit(registry, type, event = {}) {
  for (const listener of registry.get(type) || []) {
    listener(event);
  }
}

const document = {
  currentScript: null,
  activeElement: null,
  visibilityState: "visible",
  addEventListener(type, listener) {
    listen(documentListeners, type, listener);
  },
  removeEventListener() {},
  querySelector() { return null; },
  createElement() { return { setAttribute() {} }; },
};

const context = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout() { return 0; },
  clearTimeout() {},
  requestAnimationFrame(callback) { return callback(0); },
  cancelAnimationFrame() {},
  addEventListener(type, listener) {
    listen(globalListeners, type, listener);
  },
  dispatchEvent(event) {
    dispatchedEvents.push(event);
    return true;
  },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  },
  removeEventListener() {},
  document,
  VfGeomCore: {},
};
context.window = context;
context.globalThis = context;

vm.createContext(context);
vm.runInContext(source, context, { filename: "vf-display.js" });

const arrowLeft = {
  key: "ArrowLeft",
  code: "ArrowLeft",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

emit(globalListeners, "keydown", arrowLeft);
assert.equal(context.VfInput.isDown("ArrowLeft"), true);
const firstDownSeq = context.VfInput.seq;
for (let repeat = 0; repeat < 20; repeat += 1) {
  emit(globalListeners, "keydown", { ...arrowLeft, repeat: true });
}
assert.equal(
  context.VfInput.seq,
  firstDownSeq,
  "browser key-repeat must not create held-input state transitions",
);
assert.equal(
  dispatchedEvents.filter((event) => event.detail?.event === "key_down").length,
  1,
  "one physical press must dispatch exactly one key_down",
);
emit(globalListeners, "keyup", arrowLeft);
assert.equal(context.VfInput.isDown("ArrowLeft"), false);
const firstUpSeq = context.VfInput.seq;
emit(globalListeners, "keyup", arrowLeft);
assert.equal(
  context.VfInput.seq,
  firstUpSeq,
  "duplicate keyup must not create another input transition",
);
assert.equal(
  dispatchedEvents.filter((event) => event.detail?.event === "key_up").length,
  1,
  "one physical release must dispatch exactly one key_up",
);

emit(globalListeners, "keydown", arrowLeft);
emit(globalListeners, "blur");
assert.equal(
  context.VfInput.isDown("ArrowLeft"),
  false,
  "losing overlay focus must release held keys when Windows cannot deliver keyup",
);

emit(globalListeners, "keydown", arrowLeft);
document.visibilityState = "hidden";
emit(documentListeners, "visibilitychange");
assert.equal(
  context.VfInput.isDown("ArrowLeft"),
  false,
  "hiding the overlay document must release held keys",
);

console.log("vf-input held-key reset tests passed");
