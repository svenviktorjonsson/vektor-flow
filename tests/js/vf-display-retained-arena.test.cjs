const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8",
);
class Element {}
const katexCalls = [];
function node() {
  return {
    className: "",
    style: {},
    innerHTML: "",
    textContent: "",
    appendChild(child) {
      this.innerHTML += child.innerHTML || child.textContent || "";
    },
  };
}
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  Uint8Array,
  Float32Array,
  Uint32Array,
  Element,
  VfRuntimeShell: {},
  katex: {
    renderToString(value, options) {
      katexCalls.push({ value, options });
      return `<math>${value}</math>`;
    },
  },
  setTimeout() { return 0; },
  clearTimeout() {},
  setInterval() { return 0; },
  clearInterval() {},
  addEventListener() {},
  document: {
    currentScript: null,
    body: null,
    visibilityState: "visible",
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return node(); },
    createTextNode(value) { return { textContent: String(value) }; },
  },
};
sandbox.window = sandbox;
vm.runInNewContext(source, sandbox, { filename: "vf-display.js" });

const bytes = new Uint8Array(28);
new Float32Array(bytes.buffer, 0, 4).set([1, 2, 3, 4]);
new Uint32Array(bytes.buffer, 16, 3).set([0, 1, 2]);
const packet = {
  schema: "vektor-flow/retained-scene-arena",
  version: 1,
  metadata: {
    schema: "vektor-flow/retained-scene-arena",
    version: 1,
    scene: {
      frame: "frame_7",
      meshes: [{
        id: "line",
        topology: "line-list",
        axis_ticks: { enabled: true, x_label: "x", y_label: "y" },
        vertices: { byte_offset: 0, length: 4, storage: "float32" },
        indices: { byte_offset: 16, length: 3, storage: "uint32" },
      }],
    },
  },
  arena: bytes,
};
const display = sandbox.VfDisplay.__test.materializeRetainedSceneArena(packet);
assert.deepEqual([...display.geom.frame_7.meshes[0].vertices], [1, 2, 3, 4]);
assert.deepEqual([...display.geom.frame_7.meshes[0].indices], [0, 1, 2]);
assert.equal(display.geom.frame_7.meshes[0].topology, "line-list");
assert.equal(display.geom.frame_7.meshes[0].axis_ticks.enabled, true);
assert.equal(display.geom.frame_7.background, null);
assert.equal(display.geom.frame_7.meshes[0].vertices.buffer, bytes.buffer);

const wrongStorage = structuredClone(packet);
wrongStorage.arena = bytes;
wrongStorage.metadata.scene.meshes[0].vertices.storage = "float64";
assert.throws(
  () => sandbox.VfDisplay.__test.materializeRetainedSceneArena(wrongStorage),
  /vertices retained arena storage must be float32/,
);

const tick = sandbox.VfDisplay.__test.axisMathText("2");
assert.equal(tick, "$2$");
const label = node();
sandbox.VfDisplay.__test.renderMathText(label, tick);
assert.equal(katexCalls.length, 1);
assert.equal(katexCalls[0].value, "2");
assert.equal(katexCalls[0].options.displayMode, false);
assert.equal(katexCalls[0].options.throwOnError, false);
assert.equal(label.innerHTML, "<math>2</math>");

console.log("vf-display retained arena tests passed");
