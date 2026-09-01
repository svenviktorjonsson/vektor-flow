const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const rendererPath = path.join(root, "web/vf-ui/geom/vf-geom-wgpu.js");
const rendererSource = fs.readFileSync(rendererPath, "utf8");
const context = vm.createContext({ console, Date, setTimeout, clearTimeout });
vm.runInContext(
  fs.readFileSync(path.join(root, "web/vf-ui/geom/vf-geom-math.js"), "utf8"),
  context,
  { filename: "vf-geom-math.js" }
);
vm.runInContext(rendererSource, context, { filename: "vf-geom-wgpu.js" });

function vertex(x, y, z, nx = 0, ny = 0, nz = 1) {
  return [x, y, z, nx, ny, nz, 1, 1, 1, 1];
}

function closeArray(actual, expected, epsilon = 1e-5) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= epsilon,
      `${value} differs from ${expected[index]} at index ${index}`
    );
  });
}

function normalize(values) {
  const length = Math.hypot(...values);
  return values.map((value) => value / length);
}

function subtract(a, b) {
  return a.map((value, index) => value - b[index]);
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function blinnPhongSpecular(worldPosition, worldNormal, cameraPosition, lightPosition) {
  const view = normalize(subtract(cameraPosition, worldPosition));
  const light = normalize(subtract(lightPosition, worldPosition));
  const half = normalize(light.map((value, index) => value + view[index]));
  return Math.pow(Math.max(dot(worldNormal, half), 0), 40);
}

test("mirror pass packs the reflected eye and unchanged world-space lights", () => {
  const sourceCamera = {
    pos: [0, -8.3, 4.6],
    target: [0, 0.45, 1.45],
    up: [0, 0, 1],
    fov: 43,
  };
  const mirror = {
    id: "upright_mirror",
    type: "field_mesh",
    surface_system: { kind: "screen" },
    vertices: new Float32Array([
      ...vertex(-3.7, 3.25, 0),
      ...vertex(3.7, 3.25, 0),
      ...vertex(3.7, 3.25, 3.7),
      ...vertex(-3.7, 3.25, 3.7),
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
  const renderCamera = context.VfGeomWgpuUtil.createPlanarMirrorAdapter().buildRenderCamera({
    part: { mesh: mirror },
    surfaceCamera: sourceCamera,
    viewerPos: sourceCamera.pos,
    timeMs: 0,
    targetAspect: 2,
    math: context.VfGeomMath,
  });
  closeArray(Array.from(renderCamera.pos), [0, 14.8, 4.6]);

  const lights = [
    { id: "sun", kind: "point", pos: [-3.8, -2.5, 4.8], target: [0, 0, 0], color: [1, 1, 1, 1], intensity: 58, range: 20 },
    { id: "fill", kind: "point", pos: [4, -1, 4.2], target: [0, 0, 0], color: [1, 1, 1, 1], intensity: 20, range: 17 },
  ];
  const receiverMesh = {
    id: "checker_receiver",
    kind: "field_mesh",
    mode3d: true,
    center: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    vertices: new Float32Array([
      ...vertex(-1, -1, 0),
      ...vertex(1, -1, 0),
      ...vertex(0, 1, 0),
    ]),
    indices: new Uint32Array([0, 1, 2]),
    lights,
  };
  const part = {
    mesh: receiverMesh,
    vb: {},
    ib: {},
    ibCount: 3,
    topology: "triangle-list",
    uniformBuf: {},
    bindGroup: {},
  };
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    drawIndexed() {},
  };
  let captured = null;
  const renderer = new context.VfGeomWgpu({ width: 640, height: 480 }, () => null);
  renderer._device = {
    queue: {
      writeBuffer(_target, _offset, buffer) {
        captured = buffer.slice(0);
      },
    },
  };
  renderer._bindLayout = null;
  renderer._bindClusteredLightStorage = () => {};
  renderer._pipeTri = {};
  renderer._drawSingleScenePart(
    pass,
    { camera: sourceCamera, lights },
    part,
    0,
    4 / 3,
    renderCamera,
    context.VfGeomMath,
    640,
    480
  );

  assert.ok(captured, "the mirror draw did not upload its scene uniform");
  const uniform = new Float32Array(captured);
  closeArray(Array.from(uniform.slice(32, 35)), renderCamera.pos);
  closeArray(Array.from(uniform.slice(36, 39)), lights[0].pos);
  closeArray(Array.from(uniform.slice(44, 47)), lights[1].pos);
});

test("checker seam specular uses the virtual eye without reflecting world lights", () => {
  const seam = [0, -0.25, 0];
  const normal = [0, 0, 1];
  const mainEye = [0, -8.3, 4.6];
  const reflectedEye = [0, 14.8, 4.6];
  const worldLights = [[-3.8, -2.5, 4.8], [4, -1, 4.2]];
  const reflectedLights = worldLights.map(([x, y, z]) => [x, 6.5 - y, z]);
  const sum = (eye, lights) => lights.reduce(
    (total, light) => total + blinnPhongSpecular(seam, normal, eye, light),
    0
  );

  const mainSpecular = sum(mainEye, worldLights);
  const mirrorSpecular = sum(reflectedEye, worldLights);
  const wrongReflectedLightSpecular = sum(reflectedEye, reflectedLights);
  assert.ok(mirrorSpecular > mainSpecular * 20, "the probe is not sensitive to the reflected eye");
  assert.ok(
    mirrorSpecular > wrongReflectedLightSpecular * 1e8,
    "the probe is not sensitive to incorrectly reflected world lights"
  );
});

test("shader keeps receiver data in world space and does not relight an opaque full reflection", () => {
  assert.match(rendererSource, /let V = normalize\(sc\.cam_pos - worldPos\)/u);
  assert.match(rendererSource, /let wp = \(sc\.model \* vec4f\(v\.pos, 1\.0\)\)\.xyz/u);
  assert.match(rendererSource, /o\.normal = normalize\(\(sc\.model \* vec4f\(v\.normal, 0\.0\)\)\.xyz\)/u);
  assert.match(rendererSource, /let reflectedLayer = mix\(backgroundLayer, reflectionSample\.rgb, reflectionAlpha\)/u);
  assert.match(rendererSource, /let mirrorComposite = mix\(backgroundLayer, reflectedLayer, reflectivity\)/u);
  assert.match(rendererSource, /let tintedComposite = mix\(mirrorComposite, base, windowTintStrength\)/u);

  const base = [0.02, 0.02, 0.025];
  const opaqueReflection = [0.72, 0.31, 0.08];
  const mix = (a, b, amount) => a.map((value, index) => value * (1 - amount) + b[index] * amount);
  const reflectedLayer = mix(base, opaqueReflection, 1);
  const mirrorComposite = mix(base, reflectedLayer, 1);
  const nonWindowComposite = mix(mirrorComposite, base, 0);
  assert.deepEqual(nonWindowComposite, opaqueReflection);
});
