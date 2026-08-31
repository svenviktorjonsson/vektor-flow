import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clusterIndexForReceiver,
  evaluateClusteredDirectLights
} from '../../web/vf-ui/geom/vf-clustered-light-shading-oracle.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = fs.readFileSync(
  path.join(testDirectory, '../../web/vf-ui/geom/vf-geom-wgpu.js'),
  'utf8'
);

test('receiver depth uses logarithmic positive view depth rather than radial distance', () => {
  const grid = {
    xSlices: 1,
    ySlices: 1,
    depthSlices: 4,
    nearDepth: 1,
    farDepth: 16
  };

  const index = clusterIndexForReceiver({
    ndc: [0, 0],
    worldPosition: [3, 0, 4],
    cameraPosition: [0, 0, 0],
    cameraForward: [0, 0, 1],
    grid
  });

  // Positive view depth is 4 (slice 2); radial distance is 5 and must not
  // influence the result.
  assert.equal(index, 2);
});

test('receiver depth normalizes the camera forward vector', () => {
  const index = clusterIndexForReceiver({
    ndc: [0, 0],
    worldPosition: [0, 0, 4],
    cameraPosition: [0, 0, 0],
    cameraForward: [0, 0, 2],
    grid: {
      xSlices: 1,
      ySlices: 1,
      depthSlices: 4,
      nearDepth: 1,
      farDepth: 16
    }
  });

  assert.equal(index, 2);
});

test('a retained fifth light contributes without changing the first-four direct sum', () => {
  const light = {
    position: [0, 0, 2],
    range: 0,
    color: [1, 1, 1],
    intensity: 4,
    direction: [0, 0, -1],
    kindCode: 0,
    innerConeCos: -1,
    outerConeCos: -1
  };
  const receiver = {
    worldPosition: [0, 0, 0],
    normal: [0, 0, 1],
    cameraPosition: [0, 0, 10],
    baseColor: [0.5, 0.25, 0.125],
    alpha: 1,
    specularScale: 1,
    specularStrength: 1
  };

  const firstFour = evaluateClusteredDirectLights({
    lights: [light, light, light, light],
    receiver
  });
  const fifthOnly = evaluateClusteredDirectLights({
    lights: [light, light, light, light, light],
    receiver,
    skipLightIdsBelow: 4
  });

  assert.deepEqual(firstFour.diffuse, [2, 1, 0.5]);
  assert.deepEqual(firstFour.specular, [7.2, 7.2, 7.2]);
  assert.deepEqual(fifthOnly.diffuse, [0.5, 0.25, 0.125]);
  assert.deepEqual(fifthOnly.specular, [1.8, 1.8, 1.8]);
});

test('main receiver shader consumes retained clustered lights after the legacy four', () => {
  assert.match(rendererSource, /@group\(1\) @binding\(0\) var<storage, read> clusteredLightPlan/);
  assert.match(rendererSource, /@group\(1\) @binding\(1\) var<storage, read> clusteredLightRecords/);
  assert.match(rendererSource, /dot\(worldPos - sc\.cam_pos, sc\.depth_params\.yzw\)/);
  assert.match(rendererSource, /if \(lightId < 4u\)\s*\{\s*continue;/);
  assert.match(rendererSource, /let clustered = clusteredAdditionalDirectLights[\s\S]*diffuse \+= clustered\.diffuse[\s\S]*specular \+= clustered\.specular/);

  // Both opaque and transparent triangle pipelines reach the same receiver
  // fragment entry, so neither path can silently retain the four-light cap.
  assert.match(rendererSource, /pipeTri\s*=.*makeDesc\("triangle-list"\)/);
  assert.match(rendererSource, /pipeTriAlpha\s*=.*makeDesc\("triangle-list", null, true\)/);
  assert.match(rendererSource, /fragment:\s*\{ module: mod, entryPoint: fragmentEntry \|\| "fs"/);
});
