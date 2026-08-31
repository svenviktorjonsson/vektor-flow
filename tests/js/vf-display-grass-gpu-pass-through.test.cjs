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
    createElement() { return { setAttribute() {} }; },
    head: { appendChild() {} },
    body: null,
    documentElement: null,
  },
  VfGeomCore: {},
});
vm.runInContext(source, context, { filename: "vf-display.js" });

const grassGpu = Object.freeze({
  kind: "grass-blade-philox:v1",
  cell_records: new Uint32Array(24),
  cell_stride_words: 12,
  blades_per_cell: 2,
});
const spec = {
  type: "field_mesh",
  id: "grass:view-batch:v1",
  vertices: new Float32Array(40),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  instance_kind: "grass-blade-list",
  instance_count: 4,
  grass_gpu: grassGpu,
  static_vertices: true,
  static_indices: true,
  static_instances: false,
  casts_shadow: true,
  retained_signature: "grass:cell:2:-1:2|grass:cell:3:-1:2",
};

const built = context.VfDisplay.__test.buildSingleMesh(spec, null, []);

assert.equal(built.id, spec.id);
assert.equal(built.instance_kind, spec.instance_kind);
assert.equal(built.instance_count, spec.instance_count);
assert.equal(built.instances, undefined);
assert.equal(built.grass_gpu, grassGpu);
assert.equal(built.static_instances, false);
assert.equal(built.casts_shadow, true);
assert.equal(built.retained_signature, spec.retained_signature);
assert.equal(built.vertices, spec.vertices);
assert.equal(built.indices, spec.indices);

console.log("vf-display grass GPU pass-through tests passed");
