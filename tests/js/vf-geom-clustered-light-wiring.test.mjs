import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  planClusteredLights,
  planViewClusteredLights
} from '../../web/vf-ui/geom/vf-clustered-light-plan.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = fs.readFileSync(
  path.join(testDirectory, '../../web/vf-ui/geom/vf-geom-wgpu.js'),
  'utf8'
);
const mathSource = fs.readFileSync(
  path.join(testDirectory, '../../web/vf-ui/geom/vf-geom-math.js'),
  'utf8'
);

function createRenderer() {
  const context = vm.createContext({
    console,
    Date,
    setTimeout,
    clearTimeout,
    GPUTextureUsage: { COPY_SRC: 1, RENDER_ATTACHMENT: 2, TEXTURE_BINDING: 4 },
    GPUBufferUsage: { COPY_DST: 8, STORAGE: 128 },
    VfGeomMath: {},
    VfClusteredLightPlan: { planClusteredLights, planViewClusteredLights }
  });
  vm.runInContext(mathSource, context, { filename: 'vf-geom-math.js' });
  vm.runInContext(rendererSource, context, { filename: 'vf-geom-wgpu.js' });
  return new context.VfGeomWgpu({ width: 640, height: 360 }, () => null);
}

const VIEW_CAMERA = Object.freeze({
  viewMatrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ],
  projectionMatrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -10 / 9, -1,
    0, 0, -10 / 9, 0
  ],
  nearDepth: 1,
  farDepth: 10
});

function normalizedLight(index) {
  return {
    id: `light-${index}`,
    kind: index % 3 === 0 ? 'spot' : (index % 3 === 1 ? 'point' : 'projected'),
    pos: [index, 2, 3],
    color_f32: [1, 0.5, 0.25, 1],
    direction_f32: [0, 0, -1],
    intensity: 20 + index,
    inner_cone_cos: 0.95,
    outer_cone_cos: 0.8,
    range: 12,
    kind_code: index % 3
  };
}

test('renderer evidence exposes more than four planned lights with bounded overflow', () => {
  const renderer = createRenderer();
  renderer._clusteredLightGrid = {
    xSlices: 2,
    ySlices: 1,
    depthSlices: 2,
    nearDepth: 0.05,
    farDepth: 500
  };
  renderer._clusteredLightMaxLightsPerCluster = 4;

  renderer._planClusteredLightsForFrame(Array.from({ length: 6 }, (_, index) => normalizedLight(index)));
  const evidence = renderer._debugRenderEvidence();

  assert.equal(evidence.activeLights, 0);
  assert.equal(evidence.plannedLights, 6);
  assert.equal(evidence.lightClusters, 4);
  assert.equal(evidence.lightClusterAssignments, 16);
  assert.equal(evidence.lightClusterOverflowAssignments, 8);
  assert.equal(evidence.lightClusterOverflowClusters, 4);
  assert.equal(evidence.lightClusterCap, 4);
});

test('renderer culls bounded point lights outside the exact camera frustum', () => {
  const renderer = createRenderer();
  renderer._clusteredLightGrid = {
    xSlices: 4,
    ySlices: 2,
    depthSlices: 4,
    nearDepth: 1,
    farDepth: 10
  };
  renderer._clusteredLightMaxLightsPerCluster = 8;

  const plan = renderer._planClusteredLightsForFrame([
    { ...normalizedLight(0), kind: 'point', pos: [0, 0, -5], range: 1 },
    { ...normalizedLight(1), kind: 'point', pos: [20, 0, -5], range: 1 }
  ], VIEW_CAMERA);

  assert.equal(plan.assignmentCount, 8);
  assert.equal(plan.culledLightCount, 1);
  assert.deepEqual([...new Set(plan.lightIds)], [0]);
  assert.equal(renderer._debugRenderEvidence().plannedLights, 2);
});

test('renderer projects spot bounds while retaining a near-plane point light', () => {
  const renderer = createRenderer();
  renderer._clusteredLightGrid = {
    xSlices: 4,
    ySlices: 2,
    depthSlices: 4,
    nearDepth: 1,
    farDepth: 10
  };
  renderer._clusteredLightMaxLightsPerCluster = 8;

  const nearPoint = { ...normalizedLight(0), kind: 'point', pos: [0, 0, -1], range: 0.5 };
  const visibleSpot = {
    ...normalizedLight(1),
    kind: 'spot',
    pos: [0, 0, -4],
    direction_f32: [0, 0, -1],
    range: 2,
    outer_cone_cos: Math.SQRT1_2
  };
  const outsideSpot = { ...visibleSpot, id: 'outside', pos: [20, 0, -4] };
  const plan = renderer._planClusteredLightsForFrame(
    [nearPoint, visibleSpot, outsideSpot],
    VIEW_CAMERA
  );

  assert.equal(plan.culledLightCount, 1);
  assert.ok(plan.assignmentCount < 96);
  assert.deepEqual([...new Set(plan.lightIds)], [0, 1]);
});

test('renderer projects a finite aperture-light volume and culls it off camera', () => {
  const renderer = createRenderer();
  renderer._clusteredLightGrid = {
    xSlices: 4,
    ySlices: 2,
    depthSlices: 4,
    nearDepth: 1,
    farDepth: 10
  };
  renderer._clusteredLightMaxLightsPerCluster = 8;

  function apertureAt(x) {
    return {
      plane_point: [x, 0, -3],
      plane_normal: [0, 0, 1],
      u_axis: [1, 0, 0],
      v_axis: [0, 1, 0],
      points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
    };
  }
  const visible = {
    ...normalizedLight(0),
    kind: 'projected',
    pos: [0, 0, -2],
    range: 1.5,
    projected_aperture: apertureAt(0)
  };
  const outside = {
    ...normalizedLight(1),
    kind: 'projected',
    pos: [20, 0, -2],
    range: 1.5,
    projected_aperture: apertureAt(20)
  };
  const plan = renderer._planClusteredLightsForFrame([visible, outside], VIEW_CAMERA);

  assert.equal(plan.culledLightCount, 1);
  assert.ok(plan.assignmentCount > 0 && plan.assignmentCount < 32);
  assert.deepEqual([...new Set(plan.lightIds)], [0]);
});

test('internal geometry emitters append after legacy lights as bounded records', () => {
  const renderer = createRenderer();
  const legacy = Array.from({ length: 4 }, (_, index) => normalizedLight(index));
  const polygon = [
    [-1, -1, -3], [1, -1, -3], [1, 1, -3], [-1, 1, -3]
  ];
  const emitters = Array.from({ length: 40 }, (_, index) => ({
    id: `patch-${index}`,
    points: polygon,
    color_f32: [0.25, 0.5, 1, 1],
    intensity: 8,
    range: 3,
    two_sided: index === 0
  }));

  const lights = renderer._clusteredLightsForScene(legacy, { _geometry_emitters: emitters });

  assert.equal(lights.length, 36);
  assert.deepEqual(lights.slice(0, 4), legacy);
  assert.deepEqual(JSON.parse(JSON.stringify(lights[4])), {
    id: 'patch-0',
    kind: 'geometry',
    kind_code: 3,
    pos: [0, 0, -3],
    direction_f32: [0, 0, 1],
    color_f32: [0.25, 0.5, 1, 1],
    intensity: 8,
    range: 3,
    inner_cone_cos: -1,
    outer_cone_cos: -1,
    source_radius: 0,
    spread: 1,
    casts_shadow: false,
    show_marker: false,
    geometry_points: polygon,
    geometry_area: 4,
    geometry_radius: Math.SQRT2,
    geometry_two_sided: true
  });
});

test('internal geometry emitters reserve legacy slots without widening public light kinds', () => {
  const renderer = createRenderer();
  const lights = renderer._clusteredLightsForScene([], {
    _geometry_emitters: [{
      points: [[0, 0, -3], [0, 1, -3], [1, 0, -3]],
      color_f32: [1, 1, 1, 1],
      intensity: 1,
      range: 2
    }]
  });

  assert.equal(lights.length, 5);
  assert.deepEqual(lights.slice(0, 4).map((light) => light.kind), ['point', 'point', 'point', 'point']);
  assert.equal(lights[4].kind, 'geometry');
  assert.match(rendererSource, /raw !== "point" && raw !== "spot" && raw !== "projected"/);
});

test('internal geometry emitters use projected bounds and packed geometry metadata', () => {
  const renderer = createRenderer();
  const writes = [];
  renderer._device = {
    createBuffer(descriptor) { return { descriptor, destroy() {} }; },
    createBindGroup(descriptor) { return { descriptor }; },
    queue: { writeBuffer(buffer, offset, data) { writes.push(new data.constructor(data)); } }
  };
  renderer._clusteredLightBindLayout = {};
  renderer._clusteredLightGrid = {
    xSlices: 4, ySlices: 2, depthSlices: 4, nearDepth: 1, farDepth: 10
  };
  const legacy = Array.from({ length: 4 }, (_, index) => ({
    ...normalizedLight(index), kind: 'point', pos: [20 + index, 0, -5], range: 1
  }));
  const lights = renderer._clusteredLightsForScene(legacy, {
    _geometry_emitters: [{
      id: 'patch',
      points: [[-1, -1, -3], [1, -1, -3], [1, 1, -3], [-1, 1, -3]],
      color_f32: [1, 0.5, 0.25, 1],
      intensity: 8,
      range: 3,
      two_sided: true
    }]
  });
  const plan = renderer._planClusteredLightsForFrame(lights, VIEW_CAMERA);

  assert.equal(plan.culledLightCount, 4);
  assert.deepEqual([...new Set(plan.lightIds)], [4]);
  const records = writes[1];
  const base = 4 * 48;
  assert.deepEqual([...records.slice(base, base + 16)].map((v) => Math.round(v * 1000) / 1000), [
    0, 0, -3, 3,
    1, 0.5, 0.25, 8,
    0, 0, 1, 3,
    4, Math.round(Math.SQRT2 * 1000) / 1000, 1, 0
  ]);
});

test('batch camera uses exact live matrices and unsafe scenes retain conservative coverage', () => {
  const renderer = createRenderer();
  renderer._clusteredLightGrid = {
    xSlices: 2,
    ySlices: 1,
    depthSlices: 2,
    nearDepth: 1,
    farDepth: 10
  };
  const scene = {
    camera: {
      projection_matrix: [...VIEW_CAMERA.projectionMatrix],
      view_matrix: [...VIEW_CAMERA.viewMatrix]
    }
  };
  renderer._parts = [{ mesh: { mode3d: true } }];

  const camera = renderer._clusteredCameraForBatchScene(scene, 0, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(camera)), {
    ...VIEW_CAMERA,
    viewMatrix: [...new Float32Array(VIEW_CAMERA.viewMatrix)],
    projectionMatrix: [...new Float32Array(VIEW_CAMERA.projectionMatrix)]
  });

  renderer._parts = [{ mesh: { mode3d: true, surface_system: { kind: 'screen' } } }];
  assert.equal(renderer._clusteredCameraForBatchScene(scene, 0, 1), null);

  const fallback = renderer._planClusteredLightsForFrame([
    { ...normalizedLight(0), kind: 'point', pos: [20, 0, -5], range: 0 }
  ], VIEW_CAMERA);
  assert.equal(fallback.culledLightCount, 0);
  assert.equal(fallback.assignmentCount, 4);
  assert.deepEqual([...new Set(fallback.lightIds)], [0]);
});

test('uploads clustered plans and light records into a bound GPU storage group', () => {
  const renderer = createRenderer();
  const createdBuffers = [];
  const writes = [];
  const bindGroups = [];
  renderer._device = {
    createBuffer(descriptor) {
      const buffer = { descriptor, destroy() {} };
      createdBuffers.push(buffer);
      return buffer;
    },
    createBindGroup(descriptor) {
      const group = { descriptor };
      bindGroups.push(group);
      return group;
    },
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, data: new data.constructor(data) });
      }
    }
  };
  renderer._clusteredLightBindLayout = { label: 'clustered-light-layout' };
  renderer._clusteredLightGrid = {
    xSlices: 1,
    ySlices: 1,
    depthSlices: 1,
    nearDepth: 0.05,
    farDepth: 500
  };
  renderer._clusteredLightMaxLightsPerCluster = 4;

  const lights = Array.from({ length: 6 }, (_, index) => normalizedLight(index));
  lights[5] = {
    ...lights[5],
    source_radius: 0.25,
    spread: 0.75,
    projected_aperture: {
      plane_point: [5, 2, 2],
      plane_normal: [0, 0, 1],
      u_axis: [1, 0, 0],
      v_axis: [0, 1, 0],
      clip_epsilon: 0.02,
      points: [[-2, -1], [2, -1], [2, 1], [-2, 1]]
    }
  };
  renderer._planClusteredLightsForFrame(lights);

  assert.equal(createdBuffers.length, 2);
  assert.ok((createdBuffers[0].descriptor.usage & 128) !== 0);
  assert.ok((createdBuffers[1].descriptor.usage & 128) !== 0);
  assert.equal(writes.length, 2);
  assert.deepEqual([...writes[0].data.slice(0, 8)], [1, 1, 1, 4, 1, 4, 2, 6]);
  const clusterHeaderFloats = new Float32Array(writes[0].data.buffer);
  assert.ok(Math.abs(clusterHeaderFloats[8] - 0.05) < 1e-6);
  assert.equal(clusterHeaderFloats[9], 500);
  assert.equal(writes[0].data.byteLength, 64);
  assert.equal(writes[1].data.byteLength, 1152);
  const projectedRecordBase = 5 * 48;
  assert.deepEqual([...writes[1].data.slice(projectedRecordBase, projectedRecordBase + 16)]
    .map((value) => Math.round(value * 100) / 100), [
    5, 2, 3, 12,
    1, 0.5, 0.25, 25,
    0, 0, -1, 2,
    0.95, 0.8, 0.25, 0.75
  ]);
  assert.deepEqual([...writes[1].data.slice(projectedRecordBase + 16, projectedRecordBase + 32)], [
    5, 2, 2, writes[1].data[projectedRecordBase + 19],
    0, 0, 1, 4,
    1, 0, 0, 0.25,
    0, 1, 0, 0.75
  ]);
  assert.ok(Math.abs(writes[1].data[projectedRecordBase + 19] - 0.02) < 1e-6);
  assert.deepEqual([...writes[1].data.slice(projectedRecordBase + 32, projectedRecordBase + 40)], [
    -2, -1, 2, -1, 2, 1, -2, 1
  ]);
  assert.deepEqual([...writes[1].data.slice(projectedRecordBase + 40, projectedRecordBase + 48)], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(bindGroups.length, 1);
  assert.deepEqual([...bindGroups[0].descriptor.entries].map((entry) => entry.binding), [0, 1]);
  assert.equal(bindGroups[0].descriptor.entries[0].resource.buffer, createdBuffers[0]);
  assert.equal(bindGroups[0].descriptor.entries[1].resource.buffer, createdBuffers[1]);
  const bound = [];
  renderer._bindClusteredLightStorage({ setBindGroup(index, group) { bound.push({ index, group }); } });
  assert.deepEqual(bound, [{ index: 1, group: bindGroups[0] }]);
  assert.equal(renderer._debugRenderEvidence().lightClusterStorageBytes, 64);
  assert.equal(renderer._debugRenderEvidence().lightRecordStorageBytes, 1152);
});
