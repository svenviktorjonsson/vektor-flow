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

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function envelopeMetric(envelope, point) {
  const dx = point[0] - envelope.center[0];
  const dy = point[1] - envelope.center[1];
  const cosine = Math.cos(envelope.orientation);
  const sine = Math.sin(envelope.orientation);
  const local = [
    dx * cosine + dy * sine,
    -dx * sine + dy * cosine,
    point[2] - envelope.center[2],
  ];
  return local.reduce((sum, value, axis) => (
    sum + (value / envelope.axes[axis]) ** 2
  ), 0);
}

function sourcePacket(detailLevel = 2, identity = IDENTITY) {
  const forest = realizeForestPatchesReference(
    createForestPopulationReference(identity),
    { patches: [[0, 0]], treeBudget: 1 },
  );
  const geometry = planTreeGeometryReference(
    createTreeGeometryPlannerReference(identity),
    forest,
    { treeIndices: [0], detailLevels: [detailLevel], primitiveBudget: 2400 },
  );
  const materials = realizeTreeMaterialsReference(
    createTreeMaterialFieldReference(identity),
    forest,
    geometry,
    { materialBudget: 2400 },
  );
  return adaptTreeWorkingSetsToRetainedPacketsReference(
    geometry,
    materials,
  ).packets[0];
}

test('complete deterministic tree becomes bounded WebGPU trunk branch and leaf meshes', () => {
  const source = sourcePacket();
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    vertexBudget: 65536,
    indexBudget: 393216,
  });
  const twigCount = Array.from(source.primitiveKinds).filter((kind) => kind === 4).length;
  const foliageCount = Array.from(source.primitiveKinds).filter((kind) => kind === 3).length;

  assert.ok(source.primitiveCount >= 720 && source.primitiveCount <= 2400);
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
    branches: 62,
    twigs: twigCount,
    foliageClusters: foliageCount,
    leaves: foliageCount * 2,
  });
  assert.ok(result.counts.leaves > 1965);
  assert.ok(result.meshes.every((mesh) => (
    mesh.type === 'field_mesh'
    && mesh.topology === 'triangle-list'
    && mesh.vertices instanceof Float32Array
    && mesh.indices instanceof Uint32Array
    && mesh.vertices.length % 10 === 0
    && mesh.uvs instanceof Float32Array
    && mesh.roughness instanceof Float32Array
    && mesh.roughness.length === mesh.vertices.length / 10
    && mesh.uvs.length === mesh.vertices.length / 5
    && mesh.indices.length % 3 === 0
    && [...mesh.vertices].every(Number.isFinite)
    && [...mesh.uvs].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  )));
  assert.ok(result.meshes.every((mesh) => (
    mesh.specular_strength >= 0.02 && mesh.specular_strength <= 0.12
  )));
  for (const mesh of result.meshes) {
    for (let vertex = 0; vertex < mesh.vertices.length / 10; vertex += 1) {
      const point = mesh.vertices.slice(vertex * 10, vertex * 10 + 3);
      assert.ok(envelopeMetric(source.envelope, point) <= 1.00001);
    }
  }
  assert.ok(result.vertexCount <= result.vertexBudget);
  assert.ok(result.indexCount <= result.indexBudget);
  assert.ok(result.meshes[0].vertices.some((value, index) => (
    index % 10 === 6 && value < 0.3
  )));
  assert.ok(result.meshes[1].vertices.some((value, index) => (
    index % 10 === 7 && value > 0.15
  )));
  const woodPoints = Array.from(
    { length: result.meshes[0].vertices.length / 10 },
    (_, vertex) => Array.from(result.meshes[0].vertices.slice(vertex * 10, vertex * 10 + 3)),
  );
  assert.ok(Math.min(...woodPoints.map((point) => distance(point, source.curves[0].points[0]))) < 1e-5);
});

test('woody split ports share one open junction mesh without internal caps', () => {
  const source = sourcePacket();
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    vertexBudget: 65536,
    indexBudget: 393216,
  });
  const wood = result.meshes[0];
  assert.ok(result.junctions.length > 0);
  const edgeUse = new Map();
  const triangleKeys = new Set();
  for (let offset = 0; offset < wood.indices.length; offset += 3) {
    const triangle = Array.from(wood.indices.slice(offset, offset + 3));
    assert.equal(new Set(triangle).size, 3);
    const key = [...triangle].sort((a, b) => a - b).join(':');
    assert.equal(triangleKeys.has(key), false);
    triangleKeys.add(key);
    for (let edge = 0; edge < 3; edge += 1) {
      const endpoints = [triangle[edge], triangle[(edge + 1) % 3]].sort((a, b) => a - b);
      const edgeKey = endpoints.join(':');
      edgeUse.set(edgeKey, (edgeUse.get(edgeKey) ?? 0) + 1);
    }
  }
  const boundaryEdges = [...edgeUse.values()].filter((count) => count === 1).length;
  assert.equal(boundaryEdges, result.woodTopology.boundaryEdges);
  assert.equal(result.woodTopology.internalCaps, 0);
  assert.equal(result.woodTopology.nonManifoldEdges, 0);
  for (const junction of result.junctions) {
    assert.ok(junction.ports.length >= 3);
    for (const port of junction.ports) {
      assert.equal(port.ringVertices.length, result.woodTopology.ringSides);
      for (let side = 0; side < port.ringVertices.length; side += 1) {
        const next = (side + 1) % port.ringVertices.length;
        const key = [port.ringVertices[side], port.ringVertices[next]]
          .sort((a, b) => a - b).join(':');
        assert.equal(edgeUse.get(key), 2, JSON.stringify({ junction: junction.point, role: port.role, side }));
      }
    }
  }
});

test('every woody path tapers and fork skins keep bounded tangent radius and bark seams', () => {
  const source = sourcePacket();
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    vertexBudget: 65536,
    indexBudget: 393216,
  });
  const woodyCount = Array.from(source.primitiveKinds)
    .filter((kind) => kind === 0 || kind === 2 || kind === 4).length;
  assert.equal(result.woodTopology.taperedSegments, woodyCount);
  assert.equal(result.woodTopology.frameTransport, 'parallel-transport');
  assert.ok(result.woodTopology.minimumTaper > 0);
  assert.ok(result.woodTopology.maximumTaper < 1);
  for (const junction of result.junctions) {
    const incoming = junction.ports.find((port) => port.role === 'incoming');
    const outgoing = junction.ports.filter((port) => port.role !== 'incoming');
    assert.ok(incoming);
    assert.ok(outgoing.every((port) => port.radius < incoming.radius));
    assert.ok(outgoing.every((port) => Math.abs(port.barkV - junction.barkV) < 0.08));
    assert.ok(junction.maximumTangentTurn > 0 && junction.maximumTangentTurn < Math.PI * 0.7);
    assert.ok(junction.maximumNormalSeamAngle < 0.35);
    assert.ok(junction.minimumRadialScale >= 0.9);
    assert.ok(junction.maximumRadialScale <= 1.001);
    assert.equal(junction.connectorComponents, 0);
  }
});

test('connected wood has only root and terminal boundaries with no degenerate or coplanar duplicates', () => {
  const source = sourcePacket();
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    vertexBudget: 65536,
    indexBudget: 393216,
  });
  const wood = result.meshes[0];
  const woody = new Set();
  const parents = new Set();
  source.primitiveKinds.forEach((kind, primitive) => {
    if (kind === 0 || kind === 2 || kind === 4) woody.add(primitive);
  });
  for (const primitive of woody) {
    if (woody.has(source.parents[primitive])) parents.add(source.parents[primitive]);
  }
  const terminalCount = [...woody].filter((primitive) => !parents.has(primitive)).length;
  assert.equal(result.woodTopology.boundaryEdges, 0);
  assert.equal(result.woodTopology.endpointCaps, terminalCount + 1);
  const point = (vertex) => Array.from(wood.vertices.slice(vertex * 10, vertex * 10 + 3));
  const geometricTriangles = new Set();
  for (let offset = 0; offset < wood.indices.length; offset += 3) {
    const points = Array.from(wood.indices.slice(offset, offset + 3), point);
    const ab = subtract(points[1], points[0]);
    const ac = subtract(points[2], points[0]);
    const doubledArea = Math.hypot(...cross(ab, ac));
    assert.ok(doubledArea > 1e-12, `wood triangle doubled area ${doubledArea}`);
    const key = points.map((position) => position.map((value) => value.toFixed(7)).join(','))
      .sort().join(':');
    assert.equal(geometricTriangles.has(key), false);
    geometricTriangles.add(key);
  }
});

test('tree WebGPU meshes replay exactly and reject incomplete or exceeded packets', () => {
  const source = sourcePacket();
  const options = { vertexBudget: 65536, indexBudget: 393216 };
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

test('procedural bark has coherent periodic grain and nonuniform color and roughness', () => {
  const source = sourcePacket();
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(source, {
    vertexBudget: 65536, indexBudget: 393216,
  });
  const wood = result.meshes[0];
  assert.ok(result.bark.ridgeCount >= source.profile.bark.ridgeCountBounds[0]);
  assert.ok(result.bark.ridgeCount <= source.profile.bark.ridgeCountBounds[1]);
  assert.ok(result.bark.textureVariant >= 0 && result.bark.textureVariant < 3);
  assert.equal(result.bark.materialChannels, 'albedo+roughness+normal+radial-displacement');
  assert.deepEqual(result.bark.features, ['ridge', 'furrow', 'fissure', 'lenticel']);
  assert.ok(Math.max(...wood.roughness) - Math.min(...wood.roughness) > 0.08);
  const colors = new Set();
  for (let vertex = 0; vertex < wood.vertices.length / 10; vertex += 1) {
    colors.add(Array.from(wood.vertices.slice(vertex * 10 + 6, vertex * 10 + 9)).join(','));
    assert.ok(envelopeMetric(source.envelope, wood.vertices.slice(vertex * 10, vertex * 10 + 3)) <= 1.00001);
  }
  assert.ok(colors.size > 20);
  const red = Array.from({ length: wood.vertices.length / 10 }, (_, vertex) => (
    wood.vertices[vertex * 10 + 6]
  ));
  assert.ok(Math.max(...red) - Math.min(...red) > 0.18);
  const grain = (angle, along) => (
    Math.sin(result.bark.ridgeCount * angle + result.bark.phase + along * result.bark.grainTurns)
      + 0.35 * Math.sin((result.bark.ridgeCount + 3) * angle
        - result.bark.phase * 0.7 + along * 9)
  );
  for (const along of [0, 0.25, 0.5, 1]) {
    assert.ok(Math.abs(grain(0, along) - grain(Math.PI * 2, along)) < 1e-12);
  }
});

test('procedural bark perturbs surface normals with bounded multiscale relief', () => {
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(sourcePacket(), {
    vertexBudget: 65536,
    indexBudget: 393216,
  });
  assert.match(result.bark.materialChannels, /normal/u);
  assert.ok(result.woodTopology.trunkBarkSides >= 24);
  assert.ok(result.bark.normalStrength >= 0.2 && result.bark.normalStrength <= 0.8);
  const wood = result.meshes[0];
  const normals = Array.from({ length: 12 }, (_, vertex) => (
    Array.from(wood.vertices.slice(vertex * 10 + 3, vertex * 10 + 6))
  ));
  const angularTurns = normals.map((normal, index) => {
    const next = normals[(index + 1) % normals.length];
    return Math.acos(Math.max(-1, Math.min(1,
      normal.reduce((sum, value, axis) => sum + value * next[axis], 0),
    )));
  });
  assert.ok(Math.max(...angularTurns) - Math.min(...angularTurns) > 0.08);
  assert.ok(angularTurns.every((turn) => turn < 1.25));
});

test('conditioned leaves form bounded petioles and pointed ovate nondegenerate blades', () => {
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(sourcePacket(), {
    vertexBudget: 65536,
    indexBudget: 393216,
  });
  const foliage = result.meshes[1];
  const stride = result.leafParameterStride;
  assert.equal(stride, 9);
  assert.equal(result.leafParameters.length, result.counts.leaves * stride);
  assert.equal(foliage.vertices.length / 10, result.counts.leaves * 12);
  assert.equal(foliage.indices.length, result.counts.leaves * 66);

  const point = (vertex) => Array.from(foliage.vertices.slice(vertex * 10, vertex * 10 + 3));
  const petioleWidth = distance(point(0), point(1));
  const interiorWidths = [[5, 7], [8, 10]].map(([left, right]) => (
    distance(point(left), point(right))
  ));
  assert.ok(petioleWidth < Math.max(...interiorWidths) * 0.25);
  assert.ok(interiorWidths.at(-1) < Math.max(...interiorWidths));
  assert.ok(distance(point(11), point(9)) > 0);

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
  const bladeAreas = [];
  for (let leaf = 0; leaf < result.counts.leaves; leaf += 1) {
    const offset = leaf * stride;
    const length = result.leafParameters[offset];
    bladeAreas.push(length * result.leafParameters[offset + 1]);
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
  assert.ok(mean(bladeAreas) < 0.02);
  assert.ok(Math.max(...bladeAreas) < 0.055);
});

test('leaf mesh carries deterministic vein albedo roughness and normal channels', () => {
  const result = adaptTreeRenderPacketToWebGpuMeshesReference(sourcePacket(), {
    vertexBudget: 65536,
    indexBudget: 393216,
  });
  assert.equal(result.leafMaterial.channels, 'albedo+roughness+normal');
  assert.equal(result.leafMaterial.translucency, 'unsupported-double-sided');
  const foliage = result.meshes[1];
  const reds = []; const roughness = []; const normals = [];
  for (let vertex = 0; vertex < Math.min(140, foliage.vertices.length / 10); vertex += 1) {
    reds.push(foliage.vertices[vertex * 10 + 6]);
    roughness.push(foliage.roughness[vertex]);
    normals.push(foliage.vertices[vertex * 10 + 3]);
  }
  assert.ok(Math.max(...reds) - Math.min(...reds) > 0.04);
  assert.ok(Math.max(...roughness) - Math.min(...roughness) > 0.06);
  assert.ok(Math.max(...normals) - Math.min(...normals) > 0.15);
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
  const key = Number(source.match(/intensity: span \* span \* (\d+(?:\.\d+)?),/u)?.[1]);
  const fillMatches = [...source.matchAll(/intensity: span \* span \* (\d+(?:\.\d+)?),/gu)];
  const fill = Number(fillMatches[1]?.[1]);
  assert.ok(key >= 1.8 && key <= 2.4);
  assert.ok(fill >= 1 && fill <= 1.5);
  assert.doesNotMatch(source, /requestAnimationFrame|\b(?:physics|motion|wind)\b/iu);
});
