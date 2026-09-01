const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/geom/vf-geom-wgpu.js"),
  "utf8"
);

const context = vm.createContext({
  console,
  Date,
  setTimeout,
  clearTimeout,
  VfGeomMath: {},
});
vm.runInContext(source, context, { filename: "vf-geom-wgpu.js" });

const renderer = new context.VfGeomWgpu(
  { width: 1024, height: 708 },
  () => null
);

function vertex(x, y, z) {
  return [x, y, z, 0, -1, 0, 1, 1, 1, 1];
}

const uprightMirror = {
  mesh: {
    surface_system: { kind: "screen" },
    vertices: new Float32Array([
      ...vertex(-3.25, 4.35, 0.15),
      ...vertex(3.25, 4.35, 0.15),
      ...vertex(3.25, 4.35, 3.85),
      ...vertex(-3.25, 4.35, 3.85),
    ]),
  },
};

assert.deepEqual(
  JSON.parse(JSON.stringify(renderer._surfaceTargetDimsForPart(uprightMirror, 1024, 708))),
  { width: 1024, height: 583 }
);
