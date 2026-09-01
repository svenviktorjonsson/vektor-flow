import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

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

function sha256(bytes) {
  return createHash('sha256')
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest('hex')
    .toUpperCase();
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
  assert.equal(
    sha256(endGrain.imageRgba8),
    '42FB44A549BF93745A4044F1ADD5ED5B4C12EF3DAD0C6A89571B1AC0F5248820',
  );
  assert.equal(
    sha256(sideGrain.imageRgba8),
    '793F6F5ADA3FAFFAFF37A0D27E0F2A23DC9694B39CD5184C34DED0E31A9A2EF9',
  );
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

test('surface packet triangulates the grid without copying its material vectors', () => {
  const { endGrain: grid } = makeCutGrids();
  const packet = packWoodCutSurfacePacketReference(grid, 'end-grain');

  assert.strictEqual(packet.positions, grid.positions);
  assert.strictEqual(packet.growthCoordinates, grid.growthCoordinates);
  assert.strictEqual(packet.baseColors, grid.baseColors);
  assert.strictEqual(packet.surfaceChannels, grid.surfaceChannels);
  assert.ok(packet.indices instanceof Uint32Array);
  assert.equal(packet.indices.length, (5 - 1) * (5 - 1) * 6);
  assert.deepEqual(Array.from(packet.indices.slice(0, 6)), [0, 1, 5, 1, 6, 5]);
  assert.deepEqual(packet.normal, [0, 0, 1]);
  assert.equal(packet.vectorBytes, packet.imageBytes + packet.indices.byteLength);
});

test('unchanged cut grids retain exact orientation-specific surface packets', () => {
  const { endGrain: grid } = makeCutGrids();
  const first = packWoodCutSurfacePacketReference(grid, 'end-grain');
  const retained = packWoodCutSurfacePacketReference(grid, 'end-grain');
  const side = packWoodCutSurfacePacketReference(grid, 'side-grain');

  assert.strictEqual(retained, first);
  assert.notStrictEqual(side, first);
  assert.strictEqual(side.positions, first.positions);
  assert.notStrictEqual(side.imageRgba8, first.imageRgba8);
});
