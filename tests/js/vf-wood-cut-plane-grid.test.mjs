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
import {
  createWoodVolumeFieldReference,
} from '../../web/vf-ui/vf-wood-volume-field.mjs';
import {
  packWoodCutPlaneGridReference,
} from '../../web/vf-ui/vf-wood-cut-plane-grid.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function makeWoodVolume() {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [2], primitiveBudget: 64 },
  );
  return {
    coordinates: realizeWoodGrowthCoordinatesReference(
      createWoodGrowthCoordinateFieldReference(),
      geometry,
      { segmentBudget: 64 },
    ),
    field: createWoodVolumeFieldReference(IDENTITY),
  };
}

function pointOnSegment(segment, axial) {
  return segment.origin.map((origin, component) => (
    origin + segment.axis[component] * axial
  ));
}

test('transverse and longitudinal grids pack intersecting samples from one cached wood volume', () => {
  const { field, coordinates } = makeWoodVolume();
  const trunk = coordinates.segments[0];
  const center = pointOnSegment(trunk, trunk.length * 0.42);
  const common = {
    field,
    coordinates,
    segmentIndex: 0,
    center,
    axisU: trunk.radialU,
    width: trunk.radius * 1.2,
    columns: 5,
    rows: 5,
    detailLevel: 2,
    footprint: 0,
    sampleBudget: 25,
  };
  const transverse = packWoodCutPlaneGridReference({
    ...common,
    axisV: trunk.radialV,
    height: trunk.radius * 1.2,
  });
  const longitudinal = packWoodCutPlaneGridReference({
    ...common,
    axisV: trunk.axis,
    height: trunk.length * 0.4,
  });

  assert.equal(transverse.kind, 'wood-cut-plane-grid:v1');
  assert.equal(transverse.sampleCount, 25);
  assert.equal(transverse.vectorBytes, 25 * 60);
  assert.ok(transverse.positions instanceof Float32Array);
  assert.ok(transverse.growthCoordinates instanceof Float32Array);
  assert.ok(transverse.baseColors instanceof Float32Array);
  assert.ok(transverse.surfaceChannels instanceof Float32Array);
  assert.deepEqual(transverse.baseColors.length, 25 * 4);
  assert.deepEqual(transverse.surfaceChannels.length, 25 * 5);

  const middleRow = 2 * 5;
  for (let column = 0; column < 5; column += 1) {
    const sampleIndex = middleRow + column;
    assert.strictEqual(transverse.samples[sampleIndex], longitudinal.samples[sampleIndex]);
  }
});

test('packed cut grid carries its normalized plane coordinates', () => {
  const { field, coordinates } = makeWoodVolume();
  const trunk = coordinates.segments[0];
  const center = pointOnSegment(trunk, trunk.length * 0.25);
  const grid = packWoodCutPlaneGridReference({
    field,
    coordinates,
    segmentIndex: 0,
    center,
    axisU: trunk.radialU.map((value) => value * 3),
    axisV: trunk.radialV.map((value) => value * 2),
    width: 0.4,
    height: 0.2,
    columns: 3,
    rows: 3,
    detailLevel: 1,
    footprint: 0.04,
    sampleBudget: 9,
  });

  assert.deepEqual(grid.center, center);
  assert.deepEqual(grid.axisU, trunk.radialU);
  assert.deepEqual(grid.axisV, trunk.radialV);
  assert.equal(grid.width, 0.4);
  assert.equal(grid.height, 0.2);
  assert.equal(grid.detailLevel, 1);
  assert.equal(grid.footprint, 0.04);
  assert.ok(Object.isFrozen(grid.center));
  assert.ok(Object.isFrozen(grid.axisU));
  assert.ok(Object.isFrozen(grid.axisV));
});

test('cut grid reports its hard budget and rejects over-budget planes before sampling', () => {
  const { field, coordinates } = makeWoodVolume();
  const trunk = coordinates.segments[0];
  const options = {
    field,
    coordinates,
    segmentIndex: 0,
    center: pointOnSegment(trunk, trunk.length * 0.5),
    axisU: trunk.radialU,
    axisV: trunk.radialV,
    width: trunk.radius,
    height: trunk.radius,
    columns: 2,
    rows: 2,
    detailLevel: 0,
    footprint: 0.3,
    sampleBudget: 4,
  };
  const bounded = packWoodCutPlaneGridReference(options);

  assert.equal(bounded.budget, 4);
  assert.equal(bounded.truncated, false);
  assert.throws(() => packWoodCutPlaneGridReference({
    ...options,
    field: null,
    sampleBudget: 3,
  }), /exceeds sampleBudget/);
  assert.throws(() => packWoodCutPlaneGridReference({
    ...options,
    rows: 257,
    columns: 256,
    sampleBudget: 65536,
  }), /exceeds sampleBudget/);
});
