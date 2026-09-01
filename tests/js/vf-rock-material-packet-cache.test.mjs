import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptRockMaterialToRendererPacketReference,
  createRockMaterialFieldReference,
} from '../../web/vf-ui/vf-rock-material-field.mjs';
import {
  createCoarseEllipsoidReference,
} from '../../web/vf-ui/vf-demand-refined-geometry.mjs';
import {
  updateEllipsoidRefinementWorkingSetReference,
} from '../../web/vf-ui/vf-refinement-working-set.mjs';
import {
  adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference,
} from '../../web/vf-ui/vf-rock-renderer-packets.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x3c6ef372, 0xa54ff53a]),
  domain: 'material',
  hierarchy: Object.freeze(['world:highland', 'stone:47']),
  lod: 0,
  channel: 'surface',
});

function coarsePacket() {
  const coarse = createCoarseEllipsoidReference({ radii: [1.4, 0.9, 1.1] });
  const working = updateEllipsoidRefinementWorkingSetReference(coarse, null, {
    demands: [],
    vertexBudget: 0,
    faceBudget: 0,
  });
  return adaptEllipsoidWorkingSetToRetainedGeometryPacketsReference(
    working,
    null,
  ).packets[0];
}

test('unchanged retained stone geometry reuses its complete material packet', () => {
  const packet = coarsePacket();
  const field = createRockMaterialFieldReference(IDENTITY);
  const first = adaptRockMaterialToRendererPacketReference(packet, field, {
    radii: [1.4, 0.9, 1.1],
    detailLevel: 4,
    footprint: 0.0125,
  });
  const repeated = adaptRockMaterialToRendererPacketReference(packet, field, {
    radii: new Float64Array([1.4, 0.9, 1.1]),
    detailLevel: 4,
    footprint: 0.0125,
  });

  assert.strictEqual(repeated, first);
  assert.strictEqual(repeated.vertices, first.vertices);
  assert.strictEqual(repeated.material_channels, first.material_channels);
  assert.ok(Object.isFrozen(first));
});
