import assert from 'node:assert/strict';
import test from 'node:test';

import { planClusteredLights } from '../../web/vf-ui/geom/vf-clustered-light-plan.mjs';

const GRID = Object.freeze({
  xSlices: 4,
  ySlices: 2,
  depthSlices: 4,
  nearDepth: 1,
  farDepth: 100
});

function bounds(minX, maxX, minY, maxY, minDepth, maxDepth) {
  return { minX, maxX, minY, maxY, minDepth, maxDepth };
}

function occupiedClusters(plan) {
  const occupied = [];
  for (let index = 0; index < plan.clusterCount; index += 1) {
    if (plan.clusterOffsets[index + 1] > plan.clusterOffsets[index]) occupied.push(index);
  }
  return occupied;
}

test('assigns point-light bounds deterministically and culls bounds outside the frustum', () => {
  const visible = {
    id: 7,
    kind: 'point',
    bounds: bounds(-0.75, -0.25, -1, 0, 1, 100)
  };
  const outside = {
    id: 2,
    kind: 'point',
    bounds: bounds(1.1, 1.5, -0.25, 0.25, 2, 4)
  };

  const first = planClusteredLights({ grid: GRID, lights: [visible, outside], maxLightsPerCluster: 8 });
  const shuffled = planClusteredLights({ grid: GRID, lights: [outside, visible], maxLightsPerCluster: 8 });

  assert.deepEqual([...first.clusterOffsets], [...shuffled.clusterOffsets]);
  assert.deepEqual([...first.lightIds], [...shuffled.lightIds]);
  assert.deepEqual([...first.lightIds], [7, 7, 7, 7, 7, 7, 7, 7]);
  assert.deepEqual(occupiedClusters(first), [0, 1, 8, 9, 16, 17, 24, 25]);
  assert.equal(first.assignmentCount, 8);
  assert.equal(first.culledLightCount, 1);
  assert.equal(first.clusterCount, 32);
});

test('assigns point, spot, and projected bounds in stable light-id order', () => {
  const oneCluster = bounds(-0.9, -0.6, -0.9, -0.1, 1.1, 2.9);
  const plan = planClusteredLights({
    grid: GRID,
    lights: [
      { id: 30, kind: 'projected', bounds: oneCluster },
      { id: 10, kind: 'spot', bounds: oneCluster },
      { id: 20, kind: 'point', bounds: oneCluster }
    ],
    maxLightsPerCluster: 8
  });

  assert.deepEqual([...plan.lightIds], [10, 20, 30]);
  assert.equal(plan.clusterOffsets[0], 0);
  assert.equal(plan.clusterOffsets[1], 3);
  assert.equal(plan.assignmentCount, 3);
  assert.equal(plan.culledLightCount, 0);
});

test('caps every cluster and reports deterministic overflow evidence', () => {
  const oneCluster = bounds(-0.9, -0.6, -0.9, -0.1, 1.1, 2.9);
  const lights = [5, 3, 1, 4, 2].map((id) => ({ id, kind: 'point', bounds: oneCluster }));

  const plan = planClusteredLights({ grid: GRID, lights, maxLightsPerCluster: 2 });
  const reversed = planClusteredLights({ grid: GRID, lights: [...lights].reverse(), maxLightsPerCluster: 2 });

  assert.deepEqual([...plan.lightIds], [1, 2]);
  assert.deepEqual([...plan.lightIds], [...reversed.lightIds]);
  assert.equal(plan.assignmentCount, 2);
  assert.equal(plan.candidateAssignmentCount, 5);
  assert.equal(plan.overflowAssignmentCount, 3);
  assert.equal(plan.overflowClusterCount, 1);
  assert.equal(plan.overflowCounts[0], 3);
  assert.equal(plan.overflowCounts.slice(1).every((count) => count === 0), true);
  assert.ok(plan.lightIds.length <= plan.clusterCount * 2);
});

test('keeps zero-volume bounds that lie exactly on cluster boundaries', () => {
  const plan = planClusteredLights({
    grid: GRID,
    lights: [{ id: 9, kind: 'point', bounds: bounds(-0.5, -0.5, 0, 0, 2, 2) }],
    maxLightsPerCluster: 1
  });

  assert.deepEqual(occupiedClusters(plan), [5]);
  assert.deepEqual([...plan.lightIds], [9]);
});

test('rejects an unsafe cluster count before allocating cluster storage', () => {
  assert.throws(
    () => planClusteredLights({
      grid: {
        xSlices: 1025,
        ySlices: 1024,
        depthSlices: 1,
        nearDepth: 1,
        farDepth: 100
      },
      lights: [],
      maxLightsPerCluster: 1
    }),
    /cluster count 1049600 exceeds internal limit 1048576/
  );
});
