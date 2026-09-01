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

function intersectionOnPlaneZ(a, b, planeZ) {
  const t = (planeZ - a[2]) / (b[2] - a[2]);
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

const mirrorLeft = project(camera._mirrorViewProjection, [-1, -2, 2]);
const mirrorRight = project(camera._mirrorViewProjection, [1, -2, 2]);
assert.ok(
  mirrorLeft[0] > mirrorRight[0],
  "the mirror must reverse its horizontal axis exactly once"
);
const mirrorLow = project(camera._mirrorViewProjection, [0, -2, 1]);
const mirrorHigh = project(camera._mirrorViewProjection, [0, -2, 3]);
assert.ok(
  mirrorHigh[1] > mirrorLow[1],
  "the mirror must keep world Z pointing up"
);
close(camera.up[0], 0);
close(camera.up[1], 0);
close(camera.up[2], 1);

const behindMirror = project(camera._mirrorViewProjection, [0, 2, 2]);
assert.ok(
  behindMirror[2] < 0 || behindMirror[2] > 1,
  "geometry behind the mirror must be rejected by the mirror clip plane"
);

const resolvedRenderer = new context.VfGeomWgpu({ width: 800, height: 600 }, () => null);
resolvedRenderer._frameId = "material_gallery_frame";
const resolvedLockedCamera = resolvedRenderer._resolveScreenRenderCamera(
  { mesh: mirror },
  { camera: viewer },
  {
    reflect_of_frame_id: "material_gallery_frame",
    reflect_mirror_mesh_id: mirror.id,
    reflect_eye_only: true,
    lock_aperture_camera: true,
  },
  0,
  4 / 3
);
assert.deepEqual(
  JSON.parse(JSON.stringify(resolvedLockedCamera.pos.map((value) => Math.round(value)))),
  [1, 6, 2],
  "the final locked camera must retain the reflected viewer position"
);
assert.equal(
  resolvedLockedCamera._mirrorDebug.clipApplied,
  true,
  "the final locked camera must retain the mirror-plane near clip"
);

const floorMirror = {
  id: "projection_oracle_floor",
  type: "field_mesh",
  surface_system: { kind: "screen" },
  vertices: new Float32Array([
    ...vertex(-3, -3, 0),
    ...vertex(3, -3, 0),
    ...vertex(3, 3, 0),
    ...vertex(-3, 3, 0),
  ]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};
const floorViewer = {
  pos: [1, -5, 4],
  target: [0, 0, 1],
  up: [0, 0, 1],
  fov: 43,
};
const floorCamera = util.createPlanarMirrorAdapter().buildRenderCamera({
  part: { mesh: floorMirror },
  surfaceCamera: floorViewer,
  timeMs: 0,
  targetAspect: 1,
  math: context.VfGeomMath,
});
assert.deepEqual(
  JSON.parse(JSON.stringify(floorCamera.pos.map((value) => Math.round(value)))),
  [1, -5, -4],
  "a checkerboard mirror must reflect the viewer below its plane"
);
for (const subject of [[0, 0, 2], [-1, -1, 1], [1.5, 0.5, 3]]) {
  const floorHit = intersectionOnPlaneZ(floorCamera.pos, subject, 0);
  const subjectNdc = project(floorCamera._mirrorViewProjection, subject);
  const hitNdc = project(floorCamera._mirrorViewProjection, floorHit);
  close(subjectNdc[0], hitNdc[0]);
  close(subjectNdc[1], hitNdc[1]);
  assert.ok(subjectNdc[2] >= 0 && subjectNdc[2] <= 1,
    "geometry above the checkerboard mirror is clipped");
}
const belowFloor = project(floorCamera._mirrorViewProjection, [0, 0, -1]);
assert.ok(belowFloor[2] < 0 || belowFloor[2] > 1,
  "geometry below the checkerboard mirror must be rejected by its near plane");

const nestedRenderer = new context.VfGeomWgpu({ width: 800, height: 600 }, () => null);
const checkerPart = {
  objectId: 1,
  topology: "triangle-list",
  mesh: { ...floorMirror, texture: { kind: "checker" } },
};
const hostPart = { objectId: 2, topology: "triangle-list", mesh: mirror };
nestedRenderer._parts = [checkerPart, hostPart];
const nestedDraws = [];
nestedRenderer._drawSingleScenePart = (_pass, _scene, part) => {
  nestedDraws.push({ id: part.objectId, surfaceSystem: part.mesh.surface_system });
};
const pass = {
  setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {},
  drawIndexed() {}, end() {},
};
nestedRenderer._encodeScenePartsColorPass(
  { beginRenderPass: () => pass },
  {}, 0, 800, 600, {}, null, {}, { r: 0, g: 0, b: 0, a: 1 },
  viewer, 1, true, { surfaceDependencyIndex: 0 }
);
assert.deepEqual(
  nestedDraws.map((draw) => ({ id: draw.id, plain: draw.surfaceSystem == null })),
  [{ id: 2, plain: true }],
  "an earlier surface pass must render later mirrors plainly to prevent recursion"
);
nestedDraws.length = 0;
nestedRenderer._encodeScenePartsColorPass(
  { beginRenderPass: () => pass },
  {}, 0, 800, 600, {}, null, {}, { r: 0, g: 0, b: 0, a: 1 },
  viewer, 2, true, { surfaceDependencyIndex: 1 }
);
assert.deepEqual(
  nestedDraws.map((draw) => ({ id: draw.id, plain: draw.surfaceSystem == null })),
  [{ id: 1, plain: false }],
  "a later mirror must consume the completed reflective checker surface"
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
