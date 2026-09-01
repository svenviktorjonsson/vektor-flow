const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  Date,
  setTimeout,
  clearTimeout,
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../web/vf-ui/geom/vf-geom-math.js"), "utf8"),
  context,
  { filename: "vf-geom-math.js" }
);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../../web/vf-ui/geom/vf-geom-wgpu.js"), "utf8"),
  context,
  { filename: "vf-geom-wgpu.js" }
);

const util = context.VfGeomWgpuUtil;

function vertex(x, y, z) {
  return [x, y, z, 0, -1, 0, 1, 1, 1, 1];
}

function project(matrix, point) {
  const [x, y, z] = point;
  const clip = [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
  ];
  return clip.map((value, index) => index < 3 ? value / clip[3] : value);
}

function intersectionOnPlaneY(a, b, planeY) {
  const t = (planeY - a[1]) / (b[1] - a[1]);
  return a.map((value, index) => value + t * (b[index] - value));
}

function close(actual, expected, epsilon = 1e-5) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} differs from ${expected}`
  );
}

const mirror = {
  id: "projection_oracle_mirror",
  type: "field_mesh",
  surface_system: { kind: "screen", reverse_facing: true },
  vertices: new Float32Array([
    ...vertex(-2, 0, 0),
    ...vertex(-2, 0, 4),
    ...vertex(2, 0, 0),
    ...vertex(2, 0, 4),
  ]),
  indices: new Uint32Array([0, 1, 3, 0, 3, 2]),
};
const viewer = {
  pos: [1, -6, 2],
  target: [0, 0, 2],
  up: [0, 0, 1],
  fov: 43,
};

const camera = util.createPlanarMirrorAdapter().buildRenderCamera({
  part: { mesh: mirror },
  surfaceCamera: viewer,
  timeMs: 0,
  targetAspect: 1,
  math: context.VfGeomMath,
});

assert.deepEqual(
  JSON.parse(JSON.stringify(camera.pos.map((value) => Math.round(value)))),
  [1, 6, 2],
  "the render eye must be the viewer reflected across the mirror plane"
);

const virtualEye = camera.pos;
for (const subject of [
  [-1, -2, 2.8],
  [0.5, -3, 1.1],
  [-1.4, -1.5, 0],
]) {
  const mirrorHit = intersectionOnPlaneY(virtualEye, subject, 0);
  const subjectNdc = project(camera._mirrorViewProjection, subject);
  const hitNdc = project(camera._mirrorViewProjection, mirrorHit);
  close(subjectNdc[0], hitNdc[0]);
  close(subjectNdc[1], hitNdc[1]);
  assert.ok(subjectNdc[2] >= 0 && subjectNdc[2] <= 1, "front-side subject is clipped");
}

const corners = util.resolvePlanarMirrorGeometry(mirror, 0, "projection oracle").corners;
for (const point of Object.values(corners)) {
  const ndc = project(camera._mirrorViewProjection, point);
  close(ndc[0], -point[0] / 2);
  close(ndc[1], point[2] / 2 - 1);
}

const behindMirror = project(camera._mirrorViewProjection, [0, 2, 2]);
assert.ok(
  behindMirror[2] < 0 || behindMirror[2] > 1,
  "geometry behind the mirror must be rejected by the mirror clip plane"
);

const renderer = new context.VfGeomWgpu({ width: 800, height: 600 }, () => null);
const lockedPart = {
  mesh: {
    ...mirror,
    surface_system: {
      kind: "screen",
      flip_x: true,
      flip_y: true,
      camera: {
        reflect_mirror_mesh_id: mirror.id,
        lock_aperture_camera: true,
      },
    },
  },
};
renderer._parts = [lockedPart];
renderer._surfaceTargetDimsForPart = () => ({ width: 800, height: 600 });
renderer._resolveScreenRenderCamera = () => camera;
renderer._ensureSurfaceTarget = (part, width, height) => {
  part.surfaceW = width;
  part.surfaceH = height;
  part.surfaceMsaaTex = { createView: () => ({}) };
  part.surfaceColorView = {};
  part.surfaceDepthTex = { createView: () => ({}) };
};
renderer._sceneBackgroundClear = () => ({ r: 0, g: 0, b: 0, a: 1 });
renderer._encodeScenePartsColorPass = () => {};
renderer._ensurePartBindGroup = () => {};
renderer._renderSurfacePasses({}, { camera: viewer }, 0, 800, 600);

assert.deepEqual(
  JSON.parse(JSON.stringify(lockedPart.mesh._surfaceProjectorMatrix)),
  JSON.parse(JSON.stringify(camera._mirrorViewProjection)),
  "an aperture-locked mirror must retain its physical view-projection mapping"
);
assert.equal(lockedPart.mesh.surface_system._projective_texture, true);
assert.equal(lockedPart.mesh.surface_system.flip_x, true, "authored horizontal flip changed");
assert.equal(lockedPart.mesh.surface_system.flip_y, true, "authored vertical flip changed");
