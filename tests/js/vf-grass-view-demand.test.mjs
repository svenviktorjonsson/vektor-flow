import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGrassMaterialFieldReference,
  createGrassRendererPacketsReference,
} from '../../web/vf-ui/vf-grass-material-field.mjs';
import {
  selectGrassViewDemandReference,
} from '../../web/vf-ui/vf-grass-view-demand.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: [0x01234567, 0x89abcdef],
  domain: 'material',
  hierarchy: ['world:temperate', 'grass-field:3'],
  lod: 0,
  channel: 'surface',
});

const CAMERA = Object.freeze({
  eye: Object.freeze([0, -6, 6]),
  target: Object.freeze([0, 0, 0]),
  up: Object.freeze([0, 0, 1]),
  verticalFovRadians: Math.PI / 3,
  viewportWidth: 800,
  viewportHeight: 600,
});

test('camera frustum emits bounded canonical grass cells consumable by the renderer', () => {
  const demand = selectGrassViewDemandReference({
    camera: CAMERA,
    planeZ: 0,
    cellBudget: 64,
    bladeBudget: 128,
  });
  const recreated = selectGrassViewDemandReference({
    camera: { ...CAMERA },
    planeZ: 0,
    cellBudget: 64,
    bladeBudget: 128,
  });
  const workingSet = createGrassRendererPacketsReference(
    createGrassMaterialFieldReference(IDENTITY),
    demand,
  );

  assert.deepEqual(demand, recreated);
  assert.equal(demand.kind, 'grass-view-demand:v1');
  assert.ok(demand.cells.length > 0);
  assert.ok(demand.cells.length <= 64);
  assert.equal(new Set(demand.cells.map((cell) => cell.join(':'))).size, demand.cells.length);
  assert.deepEqual(demand.cells, [...demand.cells].sort((first, second) => (
    first[0] - second[0] || first[1] - second[1]
  )));
  assert.ok(demand.detailLevel >= 0 && demand.detailLevel <= 4);
  assert.ok(demand.footprint > 0);
  assert.equal(demand.bladeBudget, 128);
  assert.ok(workingSet.bladeCount <= 128);
  assert.ok(workingSet.packets.length <= demand.cells.length);
});

test('a billion-unit view selects its nearest bounded working set without scanning the world', () => {
  const demand = selectGrassViewDemandReference({
    camera: {
      eye: [0, 0, 1_000_000_000],
      target: [0, 0, 0],
      up: [0, 1, 0],
      verticalFovRadians: Math.PI / 3,
      viewportWidth: 800,
      viewportHeight: 600,
    },
    planeZ: 0,
    cellBudget: 32,
    bladeBudget: 128,
  });

  assert.equal(demand.cells.length, 32);
  assert.equal(demand.truncated, true);
  assert.ok(demand.scannedCellCount >= demand.cells.length);
  assert.ok(demand.scannedCellCount <= 65536);
  assert.ok(demand.cells.every(([x, y]) => Math.abs(x) <= 4 && Math.abs(y) <= 4));
});
