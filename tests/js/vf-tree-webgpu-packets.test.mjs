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

function distance(left, right) {
  return Math.hypot(...left.map((value, axis) => value - right[axis]));
}

function sourcePacket(detailLevel = 2, identity = IDENTITY) {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(identity),
    { patches: [[0, 0]], treeBudget: 1 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(identity),
    forest,
    { treeIndices: [0], detailLevels: [detailLevel], primitiveBudget: 128 },
  );
  const materials = realizeTreeMaterialsReference(
    createTreeMaterialFieldReference(identity),
    forest,
    geometry,
    { materialBudget: 128 },
  );
  return adaptTreeWorkingSetsToRetainedPacketsReference(
    geometry,
    materials,
  ).packets[0];
}

test('complete deterministic tree becomes bounded WebGPU trunk branch and leaf meshes', () => {
  const source = sourcePacket();
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    vertexBudget: 32768,
    indexBudget: 131072,
  });
  const twigCount = Array.from(source.primitiveKinds).filter((kind) => kind === 4).length;

  assert.ok(source.primitiveCount >= 68 && source.primitiveCount <= 128);
  assert.equal(result.kind, 'tree-webgpu-mesh-state:v1');
  assert.strictEqual(result.source, source);
  assert.equal(result.meshes.length, 2);
  assert.deepEqual(result.meshes.map(({ id }) => id), [
    `${source.id}:wood`,
    `${source.id}:foliage`,
  ]);
  assert.deepEqual(result.counts, {
    trunks: 1,
    crowns: 0,
    branches: 18,
    twigs: twigCount,
    foliageClusters: twigCount,
    leaves: twigCount * 24,
  });
  assert.ok(result.meshes.every((mesh) => (
    mesh.type === 'field_mesh'
    && mesh.topology === 'triangle-list'
    && mesh.vertices instanceof Float32Array
    && mesh.indices instanceof Uint32Array
    && mesh.vertices.length % 10 === 0
    && mesh.uvs instanceof Float32Array
    && mesh.uvs.length === mesh.vertices.length / 5
    && mesh.indices.length % 3 === 0
    && [...mesh.vertices].every(Number.isFinite)
    && [...mesh.uvs].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
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
  const options = { vertexBudget: 32768, indexBudget: 131072 };
  const first = adaptTreeRenderPacketToWebGpuMeshesReference(source, options);
  const replay = adaptTreeRenderPacketToWebGpuMeshesReference(source, options);
  assert.deepEqual(replay.meshes, first.meshes);
  assert.deepEqual(replay.counts, first.counts);
  assert.deepEqual(replay.leafParameters, first.leafParameters);
  const alternateIdentity = Object.freeze({
    ...IDENTITY,
    seed: Object.freeze([IDENTITY.seed[0], (IDENTITY.seed[1] ^ 0x9e3779b9) >>> 0]),
  });
  const alternate = adaptTreeRenderPacketToWebGpuMeshesReference(
    sourcePacket(2, alternateIdentity),
    options,
  );
  assert.notDeepEqual(
    Array.from(alternate.leafParameters.slice(0, 64)),
    Array.from(first.leafParameters.slice(0, 64)),
  );
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

test('conditioned leaves form bounded petioles and pointed ovate nondegenerate blades', () => {
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(sourcePacket(), {
    vertexBudget: 32768,
    indexBudget: 131072,
  });
  const foliage = result.meshes[1];
  const stride = result.leafParameterStride;
  assert.equal(stride, 9);
  assert.equal(result.leafParameters.length, result.counts.leaves * stride);
  assert.equal(foliage.vertices.length / 10, result.counts.leaves * 16);
  assert.equal(foliage.indices.length, result.counts.leaves * 72);

  const point = (vertex) => Array.from(foliage.vertices.slice(vertex * 10, vertex * 10 + 3));
  const petioleWidth = distance(point(0), point(1));
  const interiorWidths = [5, 7, 9, 11, 13].map((vertex) => (
    distance(point(vertex), point(vertex + 1))
  ));
  assert.ok(petioleWidth < Math.max(...interiorWidths) * 0.25);
  assert.ok(interiorWidths[0] < Math.max(...interiorWidths));
  assert.ok(interiorWidths.at(-1) < Math.max(...interiorWidths));
  assert.ok(distance(point(15), point(13)) > 0);

  for (let triangle = 0; triangle < foliage.indices.length; triangle += 3) {
    const a = point(foliage.indices[triangle]);
    const b = point(foliage.indices[triangle + 1]);
    const c = point(foliage.indices[triangle + 2]);
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const area2 = Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    );
    assert.ok(area2 > 1e-9);
  }

  const ratios = [];
  const roundness = [];
  const asymmetry = [];
  const petioleRatios = [];
  const camberRatios = [];
  const colorVariation = [];
  for (let leaf = 0; leaf < result.counts.leaves; leaf += 1) {
    const offset = leaf * stride;
    const length = result.leafParameters[offset];
    ratios.push(result.leafParameters[offset + 1] / length);
    roundness.push(result.leafParameters[offset + 2]);
    asymmetry.push(result.leafParameters[offset + 3]);
    petioleRatios.push(result.leafParameters[offset + 4] / length);
    camberRatios.push(result.leafParameters[offset + 5] / length);
    colorVariation.push(result.leafParameters[offset + 8]);
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(ratios.every((value) => value >= 0.28 - 1e-6 && value <= 0.65 + 1e-6));
  assert.ok(mean(ratios) >= 0.4 && mean(ratios) <= 0.52);
  assert.ok(roundness.every((value) => value >= 0.5 - 1e-6 && value <= 0.92 + 1e-6));
  assert.ok(mean(roundness) >= 0.65 && mean(roundness) <= 0.8);
  assert.ok(asymmetry.every((value) => value >= -0.16 - 1e-6 && value <= 0.16 + 1e-6));
  assert.ok(Math.abs(mean(asymmetry)) < 0.03);
  assert.ok(petioleRatios.every((value) => value >= 0.16 - 1e-6 && value <= 0.4 + 1e-6));
  assert.ok(mean(petioleRatios) >= 0.22 && mean(petioleRatios) <= 0.33);
  assert.ok(camberRatios.every((value) => value >= -0.08 - 1e-6 && value <= 0.08 + 1e-6));
  assert.ok(Math.abs(mean(camberRatios)) < 0.02);
  assert.ok(colorVariation.every((value) => value >= -0.06 - 1e-6 && value <= 0.06 + 1e-6));
  assert.ok(Math.abs(mean(colorVariation)) < 0.01);
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
