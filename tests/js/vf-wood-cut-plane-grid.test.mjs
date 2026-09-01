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
