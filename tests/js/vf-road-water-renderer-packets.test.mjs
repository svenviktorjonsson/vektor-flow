import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRoadConstructionFieldReference,
} from '../../web/vf-ui/vf-road-construction-field.mjs';
import {
  adaptRoadRefinementToConstructionPacketsReference,
} from '../../web/vf-ui/vf-road-construction-renderer-packets.mjs';
import {
  createRoadCoordinateFieldReference,
} from '../../web/vf-ui/vf-road-coordinate-field.mjs';
import {
  updateRoadRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-road-refinement-working-set.mjs';
import {
  createRoadWaterFieldReference,
} from '../../web/vf-ui/vf-road-water-field.mjs';
import {
  adaptRoadWearToWaterPacketsReference,
} from '../../web/vf-ui/vf-road-water-renderer-packets.mjs';
import {
  createRoadWearFieldReference,
} from '../../web/vf-ui/vf-road-wear-field.mjs';
import {
  adaptRoadConstructionToWearPacketsReference,
} from '../../web/vf-ui/vf-road-wear-renderer-packets.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x6a09e667, 0xbb67ae85]),
  domain: 'material',
  hierarchy: Object.freeze(['world:test', 'road:arterial-7']),
  lod: 0,
  channel: 'road',
});

function inputs(previous = {}) {
  const coordinateField = previous.coordinateField
    ?? createRoadCoordinateFieldReference({
      origin: [0, 0, 0],
      forward: [1, 0, 0],
      up: [0, 0, 1],
      cellSize: [1, 0.1],
      longitudinalCells: 1_000_000_000,
      lateralCells: 100,
      layerThicknesses: [1, 2, 4],
    });
  const constructionField = previous.constructionField
    ?? createRoadConstructionFieldReference({
      ...IDENTITY,
      channel: 'road-construction',
    });
  const wearField = previous.wearField ?? createRoadWearFieldReference({
    ...IDENTITY,
    channel: 'road-wear',
  });
  const waterField = previous.waterField ?? createRoadWaterFieldReference({
    ...IDENTITY,
    channel: 'road-water',
  });
  const refinement = updateRoadRefinementWorkingSetReference(
    coordinateField,
    previous.refinement ?? null,
    { demands: [[0, 49, 0]], cellBudget: 1 },
  );
  const construction = adaptRoadRefinementToConstructionPacketsReference(
    refinement,
    coordinateField,
    constructionField,
    previous.construction ?? null,
  );
  const wear = adaptRoadConstructionToWearPacketsReference(
    construction,
    refinement,
    wearField,
    previous.wear ?? null,
  );
  return {
    coordinateField,
    constructionField,
    wearField,
    waterField,
    refinement,
    construction,
    wear,
  };
}

test('road water composes retained geometry and lighting material truth', () => {
  const firstInput = inputs();
  const first = adaptRoadWearToWaterPacketsReference(
    firstInput.wear,
    firstInput.refinement,
    firstInput.wearField,
    firstInput.waterField,
    null,
  );
  const packet = first.packets[0];
  const base = firstInput.wear.packets[0];

  assert.equal(first.kind, 'road-water-renderer-packets:v1');
  assert.deepEqual(first.delta.upload, { packets: 1, bytes: 240 });
  assert.ok(packet.material_channels.waterCoverage[0] > 0);
  assert.ok(packet.material_channels.waterDepth[0] > 0);
  assert.ok(packet.vertices[2] > base.vertices[2]);
  assert.ok(packet.material_channels.roughness[0]
    < base.material_channels.roughness[0]);
  assert.ok(packet.material_channels.wetness[0]
    > base.material_channels.wetness[0]);
  assert.ok(packet.material_channels.albedo[0]
    < base.material_channels.albedo[0]);
  assert.ok(packet.specular_strength > base.specular_strength);

  const steadyInput = inputs(firstInput);
  const steady = adaptRoadWearToWaterPacketsReference(
    steadyInput.wear,
    steadyInput.refinement,
    steadyInput.wearField,
    steadyInput.waterField,
    first,
  );
  assert.strictEqual(steady.packets[0], packet);
  assert.deepEqual(steady.delta.upsert, []);
  assert.deepEqual(steady.delta.unchanged, [packet.id]);
  assert.deepEqual(steady.delta.upload, { packets: 0, bytes: 0 });
});
