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
import {
  evaluateWoodCutGgxWhiteFurnaceReference,
} from '../../web/vf-ui/vf-wood-material-energy.mjs';
import {
  adaptWoodCutMaterialToTriangleFacesReference,
} from '../../web/vf-ui/vf-wood-material-renderer-packet.mjs';

const IDENTITY = Object.freeze({
  generator: 'vkf.conditioned',
  version: 1,
  seed: Object.freeze([0x1f83d9ab, 0x5be0cd19]),
  domain: 'material',
  hierarchy: Object.freeze(['world:boreal', 'forest:north-slope']),
  lod: 0,
  channel: 'population',
});

function proceduralSideGrainMaterial() {
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
  const grid = packWoodCutPlaneGridReference({
    field: createWoodVolumeFieldReference(IDENTITY),
    coordinates,
    segmentIndex: 0,
    center,
    axisU: trunk.radialU,
    axisV: trunk.axis,
    width: trunk.radius * 1.2,
    height: trunk.length * 0.4,
    columns: 5,
    rows: 5,
    detailLevel: 2,
    footprint: 0,
    sampleBudget: 25,
  });
  return packWoodCutMaterialPacketReference(
    packWoodCutSurfacePacketReference(grid, 'side-grain'),
  );
}

function triangleNormal(positions, indices, triangle) {
  const vertices = [0, 1, 2].map((corner) => {
    const offset = indices[triangle * 3 + corner] * 3;
    return positions.subarray(offset, offset + 3);
  });
  const ab = vertices[1].map((value, component) => value - vertices[0][component]);
  const ac = vertices[2].map((value, component) => value - vertices[0][component]);
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
}

test('renderer packet consumes every procedural wood cell as two complete triangle faces', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });

  assert.equal(packet.kind, 'wood-cut-material-triangle-packet:v1');
  assert.strictEqual(packet.sourceMaterial, material);
  assert.equal(packet.vertexCount, 25);
  assert.equal(packet.triangleCount, 32);
  assert.strictEqual(packet.positions, material.positions);
  assert.strictEqual(packet.indices, material.sourceSurface.indices);
  assert.strictEqual(packet.baseColors, material.baseColors);
  assert.strictEqual(packet.normalRgba8, material.normalRgba8);
  assert.strictEqual(packet.roughnessR8, material.roughnessR8);
  assert.deepEqual(packet.tangentFrame, {
    tangent: material.sourceSurface.sourceGrid.axisU,
    bitangent: material.sourceSurface.sourceGrid.axisV,
    normal: material.sourceSurface.normal,
    handedness: 1,
  });

  const seen = new Set(packet.indices);
  assert.equal(seen.size, packet.vertexCount);
  for (let triangle = 0; triangle < packet.triangleCount; triangle += 1) {
    const normal = triangleNormal(packet.positions, packet.indices, triangle);
    const signedArea = normal.reduce((sum, value, component) => (
      sum + value * packet.tangentFrame.normal[component]
    ), 0);
    assert.ok(signedArea > 0, `triangle ${triangle} must be non-degenerate and front-facing`);
  }
});

test('renderer packet rejects a face index outside the procedural vertex set', () => {
  const material = proceduralSideGrainMaterial();
  const invalidIndices = material.sourceSurface.indices.slice();
  invalidIndices[0] = material.imageWidth * material.imageHeight;
  const invalidMaterial = Object.freeze({
    ...material,
    sourceSurface: Object.freeze({
      ...material.sourceSurface,
      indices: invalidIndices,
    }),
  });

  assert.throws(
    () => adaptWoodCutMaterialToTriangleFacesReference(invalidMaterial, {
      triangleBudget: 32,
    }),
    /triangle index 0 must reference a retained vertex/,
  );
});

test('renderer packet aligns the proven anisotropic GGX lobe to its cut-plane frame', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const furnace = evaluateWoodCutGgxWhiteFurnaceReference(material, {
    sampleBudget: 25,
  });
  const provenAnisotropic = furnace.profiles.find((profile) => (
    profile.kind === 'anisotropic-ggx'
  ));

  assert.equal(packet.ggxLobe.kind, 'wood-cut-anisotropic-ggx-lobe:v1');
  assert.equal(packet.ggxLobe.anisotropy, provenAnisotropic.anisotropy);
  assert.deepEqual(packet.ggxLobe.axisOrder, ['tangent', 'bitangent']);
  assert.deepEqual(packet.ggxLobe.alphaX, provenAnisotropic.alphaX);
  assert.deepEqual(packet.ggxLobe.alphaY, provenAnisotropic.alphaY);
  assert.equal(packet.ggxLobe.alphaX.length, packet.vertexCount);
  assert.equal(packet.ggxLobe.alphaY.length, packet.vertexCount);
  assert.ok(packet.ggxLobe.alphaX.every((alpha, sample) => (
    alpha > packet.ggxLobe.alphaY[sample]
  )));
  assert.equal(
    packet.ggxLobe.vectorBytes,
    packet.ggxLobe.alphaX.byteLength + packet.ggxLobe.alphaY.byteLength,
  );
});

test('renderer packet rejects an over-capacity GGX vertex plane before realization', () => {
  const material = proceduralSideGrainMaterial();
  const vertexCount = 65537;
  const oversizedGrid = Object.freeze({
    ...material.sourceSurface.sourceGrid,
    rows: 1,
    columns: vertexCount,
    sampleCount: vertexCount,
  });
  const oversizedSurface = Object.freeze({
    ...material.sourceSurface,
    sourceGrid: oversizedGrid,
    positions: new Float32Array(vertexCount * 3),
    indices: new Uint32Array(),
  });
  const oversizedMaterial = Object.freeze({
    ...material,
    sourceSurface: oversizedSurface,
    positions: oversizedSurface.positions,
    baseColors: new Float32Array(vertexCount * 4),
    normalRgba8: new Uint8ClampedArray(vertexCount * 4),
    roughnessR8: new Uint8Array(vertexCount),
    imageWidth: vertexCount,
    imageHeight: 1,
  });

  assert.throws(
    () => adaptWoodCutMaterialToTriangleFacesReference(oversizedMaterial, {
      triangleBudget: 0,
    }),
    /wood cut material exceeds GGX vertex capacity 65536/,
  );
});
