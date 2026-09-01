import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createForestPopulationReference,
  realizeForestPatchesReference,
} from '../../web/vf-ui/vf-forest-population.mjs';
import {
  createTreeGeometryPlannerReference,
  planTreeGeometryReference,
} from '../../web/vf-ui/vf-tree-geometry-plan.mjs';
import {
  createWoodGrowthCoordinateFieldReference,
  realizeWoodGrowthCoordinatesReference,
} from '../../web/vf-ui/vf-wood-growth-coordinates.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function dot(left, right) {
  return left.reduce((sum, value, axis) => sum + value * right[axis], 0);
}

test('wood growth coordinates keep trunk and branch attachment positions continuous', () => {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 64 },
  );
  const coordinates = realizeWoodGrowthCoordinatesReference(
    createWoodGrowthCoordinateFieldReference(),
    geometry,
    { segmentBudget: 64 },
  );

  assert.equal(coordinates.kind, 'wood-growth-coordinate-working-set:v1');
  assert.equal(coordinates.segmentCount, 5);
  assert.deepEqual(coordinates.primitiveIds, [
    geometry.primitiveIds[0],
    ...geometry.primitiveIds.slice(2, 6),
  ]);
  assert.deepEqual(Array.from(coordinates.sourceIndices), [0, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(coordinates.parents), [-1, 0, 0, 0, 0]);
  assert.equal(coordinates.vectorBytes, 5 * 68);

  const trunkOrigin = Array.from(coordinates.origins.slice(0, 3));
  const trunkAxis = Array.from(coordinates.axes.slice(0, 3));
  assert.deepEqual(trunkOrigin, Array.from(forest.positions.slice(0, 3)));
  assert.deepEqual(trunkAxis, [0, 0, 1]);
  assert.equal(coordinates.pathOffsets[0], 0);

  for (let segment = 0; segment < coordinates.segmentCount; segment += 1) {
    const axis = Array.from(coordinates.axes.slice(segment * 3, segment * 3 + 3));
    const radialU = Array.from(coordinates.radialU.slice(segment * 3, segment * 3 + 3));
    const radialV = Array.from(coordinates.radialV.slice(segment * 3, segment * 3 + 3));
    assert.ok(Math.abs(dot(axis, axis) - 1) < 1e-6);
    assert.ok(Math.abs(dot(radialU, radialU) - 1) < 1e-6);
    assert.ok(Math.abs(dot(radialV, radialV) - 1) < 1e-6);
    assert.ok(Math.abs(dot(axis, radialU)) < 1e-6);
    assert.ok(Math.abs(dot(axis, radialV)) < 1e-6);
    assert.ok(Math.abs(dot(radialU, radialV)) < 1e-6);
  }

  for (let branch = 1; branch < coordinates.segmentCount; branch += 1) {
    const origin = Array.from(coordinates.origins.slice(branch * 3, branch * 3 + 3));
    const attachment = dot(
      origin.map((value, axis) => value - trunkOrigin[axis]),
      trunkAxis,
    );
    assert.ok(Math.abs(coordinates.pathOffsets[branch] - attachment) < 1e-5);
  }
});
