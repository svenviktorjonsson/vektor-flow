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
import {
  packWoodCutMaterialPacketReference,
} from '../../web/vf-ui/vf-wood-cut-material-packet.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function makeCutSurfaces() {
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
  const trunk = coordinates.segments[0];
  const center = trunk.origin.map((origin, component) => (
    origin + trunk.axis[component] * trunk.length * 0.42
  ));
  const common = {
    field: createWoodVolumeFieldReference(IDENTITY),
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
    endGrain: packWoodCutSurfacePacketReference(packWoodCutPlaneGridReference({
      ...common,
      axisV: trunk.radialV,
      height: trunk.radius * 1.2,
    }), 'end-grain'),
    sideGrain: packWoodCutSurfacePacketReference(packWoodCutPlaneGridReference({
      ...common,
      axisV: trunk.axis,
      height: trunk.length * 0.4,
    }), 'side-grain'),
  };
}

function decodedNormal(bytes, pixel) {
  const offset = pixel * 4;
  return [0, 1, 2].map((component) => bytes[offset + component] / 127.5 - 1);
}

test('wood cut materials derive bounded normal and roughness planes from coherent cut grids', () => {
  const surfaces = makeCutSurfaces();
  const endGrain = packWoodCutMaterialPacketReference(surfaces.endGrain);
  const sideGrain = packWoodCutMaterialPacketReference(surfaces.sideGrain);

  assert.equal(endGrain.kind, 'wood-cut-material-packet:v1');
  assert.strictEqual(endGrain.sourceSurface, surfaces.endGrain);
  assert.strictEqual(endGrain.positions, surfaces.endGrain.positions);
  assert.strictEqual(endGrain.growthCoordinates, surfaces.endGrain.growthCoordinates);
  assert.ok(endGrain.normalRgba8 instanceof Uint8ClampedArray);
  assert.ok(endGrain.roughnessR8 instanceof Uint8Array);
  assert.equal(endGrain.normalRgba8.length, 25 * 4);
  assert.equal(endGrain.roughnessR8.length, 25);
  assert.equal(endGrain.vectorBytes, 25 * 5);

  for (let pixel = 0; pixel < 25; pixel += 1) {
    const normal = decodedNormal(endGrain.normalRgba8, pixel);
    assert.ok(Math.abs(Math.hypot(...normal) - 1) < 0.015);
    assert.equal(endGrain.normalRgba8[pixel * 4 + 3], 255);
  }

  assert.notDeepEqual(endGrain.normalRgba8, sideGrain.normalRgba8);
  const middleRow = 2 * 5;
  for (let column = 0; column < 5; column += 1) {
    assert.equal(
      endGrain.roughnessR8[middleRow + column],
      sideGrain.roughnessR8[middleRow + column],
    );
  }
});
