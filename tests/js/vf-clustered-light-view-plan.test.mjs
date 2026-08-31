import assert from 'node:assert/strict';
import test from 'node:test';

import { planViewClusteredLights } from '../../web/vf-ui/geom/vf-clustered-light-plan.mjs';

const CAMERA = Object.freeze({
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

const GRID = Object.freeze({
  xSlices: 4,
  ySlices: 2,
  depthSlices: 4,
  nearDepth: 1,
  farDepth: 10
});

function occupiedClusters(plan) {
  const occupied = [];
  for (let index = 0; index < plan.clusterCount; index += 1) {
    if (plan.clusterOffsets[index + 1] > plan.clusterOffsets[index]) occupied.push(index);
  }
  return occupied;
}

test('composes view projection with deterministic clustered assignment and culling', () => {
  const visible = { id: 7, kind: 'point', position: [0, 0, -5], radius: 1 };
  const outside = { id: 2, kind: 'point', position: [20, 0, -5], radius: 1 };

  const first = planViewClusteredLights({
    grid: GRID,
    camera: CAMERA,
    lights: [visible, outside],
    maxLightsPerCluster: 8
  });
  const shuffled = planViewClusteredLights({
    grid: GRID,
    camera: CAMERA,
    lights: [outside, visible],
    maxLightsPerCluster: 8
  });

  assert.deepEqual([...first.clusterOffsets], [...shuffled.clusterOffsets]);
  assert.deepEqual([...first.lightIds], [...shuffled.lightIds]);
  assert.deepEqual([...first.lightIds], Array(8).fill(7));
  assert.deepEqual(occupiedClusters(first), [17, 18, 21, 22, 25, 26, 29, 30]);
  assert.equal(first.assignmentCount, 8);
  assert.equal(first.culledLightCount, 1);
});

test('maps geometry lights to projected planner records with stable light-id order', () => {
  const plan = planViewClusteredLights({
    grid: GRID,
    camera: CAMERA,
    lights: [
      { id: 30, kind: 'point', position: [0, 0, -5], radius: 0 },
      {
        id: 10,
        kind: 'spot',
        position: [0, 0, -5],
        direction: [0, 0, -1],
        range: 0,
        outerConeCos: 1
      },
      { id: 20, kind: 'geometry', points: [[0, 0, -5]] }
    ],
    maxLightsPerCluster: 8
  });

  assert.deepEqual([...plan.lightIds], [10, 20, 30]);
  assert.equal(plan.assignmentCount, 3);
  assert.equal(plan.culledLightCount, 0);
});

test('rejects camera/grid depth disagreement before assigning clusters', () => {
  assert.throws(
    () => planViewClusteredLights({
      grid: { ...GRID, nearDepth: 0.5 },
      camera: CAMERA,
      lights: [],
      maxLightsPerCluster: 8
    }),
    /camera and grid depth ranges must match/
  );
});
