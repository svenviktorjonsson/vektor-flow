const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/geom/vf-geom-wgpu.js"),
  "utf8"
);
const nativeSceneSource = fs.readFileSync(
  path.join(__dirname, "../../web/vf-ui/vf-native-scene.js"),
  "utf8"
);

assert.match(
  nativeSceneSource,
  /if \(String\(mesh\.id \|\| ""\) === String\(hostMeshId \|\| ""\)\) \{ continue; \}/u,
  "an active screen host must never enter its own surface world"
);
assert.match(
  nativeSceneSource,
  /return maxSide <= \(Number\(clip\.epsilon \|\| 0\.0\) \|\| 0\.0\);/u,
  "coplanar mirror trim must not reappear in the reflected pass"
);

const context = vm.createContext({
  console,
  Date,
  setTimeout,
  clearTimeout,
  VfGeomMath: {},
});
vm.runInContext(source, context, { filename: "vf-geom-wgpu.js" });

const util = context.VfGeomWgpuUtil;

const renderer = new context.VfGeomWgpu(
  { width: 1024, height: 708 },
  () => null
);

function vertex(x, y, z) {
  return [x, y, z, 0, -1, 0, 1, 1, 1, 1];
}

const uprightMirror = {
  mesh: {
    type: "field_mesh",
    surface_system: { kind: "screen" },
    vertices: new Float32Array([
      ...vertex(-3.05, 4.35, 0.15),
      ...vertex(-3.05, 4.35, 4.02),
      ...vertex(3.05, 4.35, 0.15),
      ...vertex(3.05, 4.35, 4.02),
    ]),
    indices: new Uint32Array([0, 1, 3, 0, 3, 2]),
  },
};

assert.equal(util.isPlanarScreenHost(uprightMirror.mesh), true);
assert.equal(util.isPlanarScreenHost({
  surface_system: { kind: "screen" },
  vertices: new Float32Array([
    ...vertex(-1, 0, 0),
    ...vertex(1, 0, 0),
    ...vertex(1, 0, 1),
    ...vertex(-1, 0.25, 1),
  ]),
}), false);

assert.deepEqual(
  JSON.parse(JSON.stringify(renderer._surfaceTargetDimsForPart(uprightMirror, 1024, 708))),
  { width: 1024, height: 650 }
);

const uprightBounds = util.surfaceLocalBounds(uprightMirror.mesh);
assert.ok(Math.abs(uprightBounds.spanX - 6.1) < 1e-5);
assert.ok(Math.abs(uprightBounds.spanY - 3.87) < 1e-5);
assert.deepEqual(
  JSON.parse(JSON.stringify(uprightBounds.uAxis.map((value) => Math.round(value)))),
  [1, 0, 0]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(uprightBounds.vAxis.map((value) => Math.round(value)))),
  [0, 0, 1]
);
