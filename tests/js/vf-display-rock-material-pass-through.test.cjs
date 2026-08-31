const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-display.js"),
  "utf8"
);

const context = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  Float32Array,
  Uint32Array,
  WeakMap,
  Date,
  setTimeout() { return 0; },
  clearTimeout() {},
  addEventListener() {},
  document: {
    addEventListener() {},
    querySelector() { return null; },
    createElement() {
      return { setAttribute() {} };
    },
    head: { appendChild() {} },
    body: null,
    documentElement: null,
  },
  VfGeomCore: {},
});
vm.runInContext(source, context, { filename: "vf-display.js" });

const descriptor = Object.freeze({
  kind: "rock-geology-weathering-gpu:v1",
  streamWords: Object.freeze([1, 2, 3, 4]),
  radii: Object.freeze([3, 2, 1.5]),
  detailLevel: 2,
  minimumFootprint: 0,
  maxOctaves: 6,
});
const materialChannels = Object.freeze({
  surfaceCoordinates: new Float32Array([0.25, 0.75, 0.5, 0.5, 0.75, 0.25]),
  displacement: new Float32Array([0.01, 0.02, 0.03]),
  baseNormals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
});
const spec = {
  type: "field_mesh",
  id: "stable-rock-part",
  vertices: new Float32Array(30),
  indices: new Uint32Array([0, 1, 2]),
  topology: "triangle-list",
  rock_material_gpu: descriptor,
  material_channels: materialChannels,
};

const built = context.VfDisplay.__test.buildSingleMesh(spec, null, []);

assert.equal(built.id, "stable-rock-part");
assert.equal(built.rock_material_gpu, descriptor);
assert.equal(built.material_channels, materialChannels);
assert.equal(built.vertices, spec.vertices);
assert.equal(built.indices, spec.indices);

console.log("vf-display rock material pass-through tests passed");
