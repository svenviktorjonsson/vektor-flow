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
  assert.equal(first.assignmentCount, 8);
  assert.equal(first.culledLightCount, 1);
  assert.equal(first.clusterCount, 32);
});
