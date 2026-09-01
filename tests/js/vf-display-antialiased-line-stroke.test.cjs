const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);
const context = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout() { return 0; },
  clearTimeout() {},
  requestAnimationFrame(callback) { return callback(0); },
  cancelAnimationFrame() {},
  addEventListener() {},
  removeEventListener() {},
  document: {
    currentScript: null,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    createElement() { return { setAttribute() {} }; },
  },
  VfGeomCore: {},
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "vf-display.js" });

const vertices = [];
for (let index = 0; index < 3; index += 1) {
  vertices.push(index - 1, index === 1 ? 0.5 : 0, 0, 0, 0, 1, 0.1, 0.7, 1, 1);
}
const mesh = context.VfDisplay.__test.buildSingleMesh({
  type: "field_mesh",
  id: "curve",
  mode3d: false,
  topology: "line-list",
  render_mode: "line",
  marker_space: "pixel",
  edge_width: 1,
  vertices,
  indices: [0, 1, 1, 2],
}, {
  pos: [0, 0, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  ortho_scale: 1,
  viewport_width_px: 1000,
  viewport_height_px: 500,
}, []);

assert.equal(mesh.instance_kind, "line-impostor");
assert.equal(mesh.topology, "triangle-list");
assert.equal(mesh.instance_count, 2);
assert.ok(Math.abs(mesh.instances[3] - 0.002) < 1e-8,
  "edge_width is converted from one full pixel into a world-space radius");
for (let offset = 11; offset < mesh.instances.length; offset += 12) {
  assert.ok(mesh.instances[offset] < 0, "2D strokes must use the flat-color alpha path");
}

console.log("vf-display antialiased line stroke tests passed");
