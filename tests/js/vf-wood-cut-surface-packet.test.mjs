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
import {
  packWoodCutSurfacePacketReference,
} from '../../web/vf-ui/vf-wood-cut-surface-packet.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function makeCutGrids() {
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
  const field = createWoodVolumeFieldReference(IDENTITY);
  const trunk = coordinates.segments[0];
  const center = trunk.origin.map((origin, component) => (
    origin + trunk.axis[component] * trunk.length * 0.42
  ));
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
  return {
    endGrain: packWoodCutPlaneGridReference({
      ...common,
      axisV: trunk.radialV,
      height: trunk.radius * 1.2,
    }),
    sideGrain: packWoodCutPlaneGridReference({
      ...common,
      axisV: trunk.axis,
      height: trunk.length * 0.4,
    }),
  };
}

function byte(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

test('end-grain and side-grain packets preserve coherent cut pixels', () => {
  const grids = makeCutGrids();
  const endGrain = packWoodCutSurfacePacketReference(grids.endGrain, 'end-grain');
  const sideGrain = packWoodCutSurfacePacketReference(grids.sideGrain, 'side-grain');

  assert.equal(endGrain.kind, 'wood-cut-surface-packet:v1');
  assert.equal(endGrain.orientation, 'end-grain');
  assert.equal(sideGrain.orientation, 'side-grain');
  assert.strictEqual(endGrain.sourceGrid, grids.endGrain);
  assert.strictEqual(sideGrain.sourceGrid, grids.sideGrain);
  assert.equal(endGrain.imageWidth, 5);
  assert.equal(endGrain.imageHeight, 5);
  assert.ok(endGrain.imageRgba8 instanceof Uint8ClampedArray);
  assert.equal(endGrain.imageRgba8.length, 25 * 4);
  assert.deepEqual(Array.from(endGrain.imageRgba8.slice(0, 4)), (
    grids.endGrain.samples[0].baseColor.map(byte)
  ));

  const middleRow = 2 * 5;
  for (let column = 0; column < 5; column += 1) {
    const pixel = (middleRow + column) * 4;
    assert.deepEqual(
      endGrain.imageRgba8.slice(pixel, pixel + 4),
      sideGrain.imageRgba8.slice(pixel, pixel + 4),
    );
  }
});
