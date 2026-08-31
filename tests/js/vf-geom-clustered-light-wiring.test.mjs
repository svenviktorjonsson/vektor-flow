import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { planClusteredLights } from '../../web/vf-ui/geom/vf-clustered-light-plan.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = fs.readFileSync(
  path.join(testDirectory, '../../web/vf-ui/geom/vf-geom-wgpu.js'),
  'utf8'
);

function createRenderer() {
  const context = vm.createContext({
    console,
    Date,
    setTimeout,
    clearTimeout,
    GPUTextureUsage: { COPY_SRC: 1, RENDER_ATTACHMENT: 2, TEXTURE_BINDING: 4 },
    VfGeomMath: {},
    VfClusteredLightPlan: { planClusteredLights }
  });
  vm.runInContext(rendererSource, context, { filename: 'vf-geom-wgpu.js' });
  return new context.VfGeomWgpu({ width: 640, height: 360 }, () => null);
}

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
