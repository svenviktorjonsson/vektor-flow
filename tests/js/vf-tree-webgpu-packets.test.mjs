import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
  adaptTreeRenderPacketToWebGpuMeshesReference,
} from '../../web/vf-ui/vf-tree-webgpu-packets.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 269]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'tree:webgpu-demo']),
  lod: 0,
  channel: 'population',
});

function sourcePacket(detailLevel = 2) {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(IDENTITY),
    { patches: [[0, 0]], treeBudget: 1 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(IDENTITY),
    forest,
    { treeIndices: [0], detailLevels: [detailLevel], primitiveBudget: 64 },
  );
  const materials = realizeTreeMaterialsReference(
    createTreeMaterialFieldReference(IDENTITY),
    forest,
    geometry,
    { materialBudget: 64 },
  );
  return adaptTreeWorkingSetsToRetainedPacketsReference(
    geometry,
    materials,
  ).packets[0];
}

test('complete deterministic tree becomes bounded WebGPU trunk branch and leaf meshes', () => {
  const source = sourcePacket();
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    vertexBudget: 4096,
    indexBudget: 16384,
  });

  assert.equal(source.primitiveCount, 22);
  assert.equal(result.kind, 'tree-webgpu-mesh-state:v1');
  assert.strictEqual(result.source, source);
  assert.equal(result.meshes.length, 2);
  assert.deepEqual(result.meshes.map(({ id }) => id), [
    `${source.id}:wood`,
    `${source.id}:foliage`,
  ]);
  assert.deepEqual(result.counts, {
    trunks: 1,
    crowns: 1,
    branches: 4,
    foliageClusters: 16,
    leaves: 960,
  });
  assert.ok(result.meshes.every((mesh) => (
    mesh.type === 'field_mesh'
    && mesh.topology === 'triangle-list'
    && mesh.vertices instanceof Float32Array
    && mesh.indices instanceof Uint32Array
    && mesh.vertices.length % 10 === 0
    && mesh.indices.length % 3 === 0
    && [...mesh.vertices].every(Number.isFinite)
  )));
  assert.ok(result.meshes.every((mesh) => (
    mesh.specular_strength >= 0.02 && mesh.specular_strength <= 0.12
  )));
  assert.ok(result.vertexCount <= result.vertexBudget);
  assert.ok(result.indexCount <= result.indexBudget);
  assert.ok(result.meshes[0].vertices.some((value, index) => (
    index % 10 === 6 && value < 0.3
  )));
  assert.ok(result.meshes[1].vertices.some((value, index) => (
    index % 10 === 7 && value > 0.15
  )));
  const trunkCenterZ = source.transforms[2];
  const trunkLength = source.transforms[6];
  const trunkZ = Array.from(
    { length: 22 },
    (_, vertex) => result.meshes[0].vertices[vertex * 10 + 2],
  );
  assert.ok(Math.abs(Math.min(...trunkZ) - (trunkCenterZ - trunkLength * 0.5)) < 1e-5);
  assert.ok(Math.abs(Math.max(...trunkZ) - (trunkCenterZ + trunkLength * 0.5)) < 1e-5);
});

test('tree WebGPU meshes replay exactly and reject incomplete or exceeded packets', () => {
  const source = sourcePacket();
  const options = { vertexBudget: 4096, indexBudget: 16384 };
  const first = adaptTreeRenderPacketToWebGpuMeshesReference(source, options);
  const replay = adaptTreeRenderPacketToWebGpuMeshesReference(source, options);
  assert.deepEqual(replay.meshes, first.meshes);
  assert.deepEqual(replay.counts, first.counts);
  assert.throws(() => adaptTreeRenderPacketToWebGpuMeshesReference(
    sourcePacket(1),
    options,
  ), /complete tree detail packet is required/u);
  assert.throws(() => adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    ...options,
    vertexBudget: first.vertexCount - 1,
  }), /tree WebGPU vertex budget is exhausted/u);
  assert.throws(() => adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    ...options,
    indexBudget: first.indexCount - 1,
  }), /tree WebGPU index budget is exhausted/u);
});

test('static tree fixture uses the full deterministic producer chain and real renderer', async () => {
  const source = await readFile(new URL(
    '../fixtures/tree-webgpu-static-smoke.html',
    import.meta.url,
  ), 'utf8');
  for (const symbol of [
    'realizeForestPatchesReference',
    'planTreeGeometryReference',
    'realizeTreeMaterialsReference',
    'adaptTreeWorkingSetsToRetainedPacketsReference',
    'adaptTreeRenderPacketToWebGpuMeshesReference',
    'mountDynamicGeomFrame',
  ]) assert.match(source, new RegExp(symbol, 'u'));
  assert.doesNotMatch(source, /requestAnimationFrame|\b(?:physics|motion|wind)\b/iu);
});
