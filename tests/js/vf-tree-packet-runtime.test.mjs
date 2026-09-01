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
  createTreeMaterialFieldReference,
  realizeTreeMaterialsReference,
} from '../../web/vf-ui/vf-tree-material-field.mjs';
import {
  adaptTreeWorkingSetsToRetainedPacketsReference,
} from '../../web/vf-ui/vf-tree-renderer-packets.mjs';
import {
  createTreePacketRuntimeCacheReference,
} from '../../web/vf-ui/vf-tree-packet-runtime.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

test('tree packet runtime bounds active memory and releases removed tree packets', () => {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[-2, 3]], treeBudget: 32 },
  );
  const planner = createTreeGeometryPlannerReference(IDENTITY);
  const materialField = createTreeMaterialFieldReference(IDENTITY);
  const renders = [];
  const runtime = createTreePacketRuntimeCacheReference({
    byteBudget: 24 * 71,
    requestRender: (packets, receipt) => renders.push({ packets, receipt }),
  });
  const realize = (treeIndices, detailLevels, previous = null) => {
    const geometry = planTreeGeometryReference(planner, forest, {
      treeIndices,
      detailLevels,
      primitiveBudget: 64,
    });
    const materials = realizeTreeMaterialsReference(
      materialField,
      forest,
      geometry,
      { materialBudget: 64 },
    );
    return adaptTreeWorkingSetsToRetainedPacketsReference(
      geometry,
      materials,
      previous,
    );
  };

  const coarse = realize([0, 1], [0, 0]);
  const coarseReceipt = runtime.applyDelta(coarse.delta);
  assert.deepEqual(coarseReceipt, {
    changed: true,
    upserted: coarse.packets.map(({ id }) => id),
    removed: [],
    packetCount: 2,
    primitiveCount: 4,
    bytes: 4 * 71,
    upload: { packets: 2, primitives: 4, bytes: 4 * 71 },
  });
  assert.deepEqual(runtime.status(), {
    packetCount: 2,
    primitiveCount: 4,
    bytes: 4 * 71,
    byteBudget: 24 * 71,
  });

  const refined = realize([0, 1], [2, 0], coarse);
  const refinedReceipt = runtime.applyDelta(refined.delta);
  assert.equal(refinedReceipt.packetCount, 2);
  assert.equal(refinedReceipt.primitiveCount, 24);
  assert.equal(refinedReceipt.bytes, 24 * 71);
  assert.strictEqual(runtime.packets()[1], coarse.packets[1]);

  const remaining = realize([1], [0], refined);
  const removedReceipt = runtime.applyDelta(remaining.delta);
  assert.deepEqual(removedReceipt.removed, [refined.packets[0].id]);
  assert.deepEqual(runtime.status(), {
    packetCount: 1,
    primitiveCount: 2,
    bytes: 2 * 71,
    byteBudget: 24 * 71,
  });
  assert.strictEqual(runtime.packets()[0], coarse.packets[1]);
  assert.equal(renders.length, 3);
});
