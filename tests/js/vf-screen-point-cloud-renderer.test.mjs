import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectPointCloud3DToScreen
} from '../../web/vf-ui/geom/vf-screen-point-cloud-renderer.mjs';

test('projects a compact 3D point cloud into one packed screen buffer', () => {
  const positions = new Float64Array([
    1, 2, 3,
    -1, 0, 2
  ]);
  const projected = projectPointCloud3DToScreen(positions, 2, {
    worldOrigin: [0, 0, 0],
    screenOrigin: [400, 300],
    xAxis: [10, 1],
    yAxis: [2, -8],
    zAxis: [-1, -3]
  });

  assert.ok(projected instanceof Float32Array);
  assert.deepEqual([...projected], [411, 276, 388, 293]);
});

test('projects 100,000 points without expanding them into marker triangles', () => {
  const count = 100_000;
  const positions = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = index * 1e-6;
    positions[index * 3 + 1] = index * -1e-7;
  }
  const started = performance.now();
  const projected = projectPointCloud3DToScreen(positions, count, {
    worldOrigin: [0, 0, 0],
    screenOrigin: [600, 400],
    xAxis: [1000, 0],
    yAxis: [0, -1000],
    zAxis: [0, 0]
  });
  const elapsed = performance.now() - started;

  assert.equal(projected.length, count * 2);
  assert.ok(elapsed < 50, `100k point projection took ${elapsed.toFixed(1)} ms`);
});
