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
  evaluateWoodFaceGgxResponseReference,
  evaluateWoodMeshGgxAreaSummaryReference,
  evaluateWoodMeshGgxAzimuthProfileReference,
  evaluateWoodMeshGgxCentroidsReference,
  evaluateWoodOrientationGgxProfilesReference,
  evaluateWoodRefinementGgxConvergenceReference,
  evaluateWoodRefinementGgxProfilesReference,
  evaluateWoodTriangleGgxBatchReference,
  evaluateWoodTriangleGgxCoverageReference,
  sampleWoodMaterialTriangleReference,
  selectWoodRefinementGgxProfileBatchReference,
  selectWoodRefinementGgxProfileReference,
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

function proceduralWoodMaterial(orientation, detailLevel = 2) {
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
  const endGrain = orientation === 'end-grain';
  const grid = packWoodCutPlaneGridReference({
    field: createWoodVolumeFieldReference(IDENTITY),
    coordinates,
    segmentIndex: 0,
    center,
    axisU: trunk.radialU,
    axisV: endGrain ? trunk.radialV : trunk.axis,
    width: trunk.radius * 1.2,
    height: endGrain ? trunk.radius * 1.2 : trunk.length * 0.4,
    columns: 5,
    rows: 5,
    detailLevel,
    footprint: 0,
    sampleBudget: 25,
  });
  return packWoodCutMaterialPacketReference(
    packWoodCutSurfacePacketReference(grid, orientation),
  );
}

function proceduralSideGrainMaterial() {
  return proceduralWoodMaterial('side-grain');
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

function interpolate(values, components, vertexIndices, barycentric) {
  return Array.from({ length: components }, (_, component) => (
    vertexIndices.reduce((sum, vertex, corner) => (
      sum + values[vertex * components + component] * barycentric[corner]
    ), 0)
  ));
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((component) => component / length);
}

test('renderer resolves one complete wood face into an anisotropic shading sample', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const triangle = 7;
  const barycentric = [0.2, 0.3, 0.5];
  const sample = sampleWoodMaterialTriangleReference(packet, {
    triangle,
    barycentric,
  });
  const vertexIndices = Array.from(packet.indices.subarray(
    triangle * 3,
    triangle * 3 + 3,
  ));
  const expectedPosition = interpolate(
    packet.positions,
    3,
    vertexIndices,
    barycentric,
  );
  const expectedBaseColor = interpolate(
    packet.baseColors,
    4,
    vertexIndices,
    barycentric,
  );
  const decodedNormals = new Float64Array(packet.vertexCount * 3);
  for (let vertex = 0; vertex < packet.vertexCount; vertex += 1) {
    const encodedOffset = vertex * 4;
    const tangentNormal = normalize([0, 1, 2].map((component) => (
      packet.normalRgba8[encodedOffset + component] / 127.5 - 1
    )));
    decodedNormals.set(tangentNormal, vertex * 3);
  }
  const tangentNormal = normalize(interpolate(
    decodedNormals,
    3,
    vertexIndices,
    barycentric,
  ));
  const expectedSurfaceNormal = normalize([0, 1, 2].map((component) => (
    packet.tangentFrame.tangent[component] * tangentNormal[0]
    + packet.tangentFrame.bitangent[component] * tangentNormal[1]
    + packet.tangentFrame.normal[component] * tangentNormal[2]
  )));
  const expectedAlphaX = interpolate(
    packet.ggxLobe.alphaX,
    1,
    vertexIndices,
    barycentric,
  )[0];
  const expectedAlphaY = interpolate(
    packet.ggxLobe.alphaY,
    1,
    vertexIndices,
    barycentric,
  )[0];

  assert.equal(sample.kind, 'wood-cut-anisotropic-face-sample:v1');
  assert.strictEqual(sample.sourcePacket, packet);
  assert.equal(sample.triangle, triangle);
  assert.deepEqual(sample.vertexIndices, vertexIndices);
  assert.deepEqual(sample.barycentric, barycentric);
  sample.position.forEach((value, component) => (
    assert.ok(Math.abs(value - expectedPosition[component]) < 1e-7)
  ));
  sample.baseColor.forEach((value, component) => (
    assert.ok(Math.abs(value - expectedBaseColor[component]) < 1e-7)
  ));
  sample.surfaceNormal.forEach((value, component) => (
    assert.ok(Math.abs(value - expectedSurfaceNormal[component]) < 1e-7)
  ));
  assert.ok(Math.abs(Math.hypot(...sample.surfaceNormal) - 1) < 1e-12);
  assert.ok(Math.abs(sample.alphaX - expectedAlphaX) < 1e-7);
  assert.ok(Math.abs(sample.alphaY - expectedAlphaY) < 1e-7);
  assert.ok(sample.alphaX > sample.alphaY);
});

function dot(left, right) {
  return left.reduce((sum, value, component) => (
    sum + value * right[component]
  ), 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

test('one wood face evaluates a tangent-oriented anisotropic GGX response', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const sample = sampleWoodMaterialTriangleReference(packet, {
    triangle: 7,
    barycentric: [0.2, 0.3, 0.5],
  });
  const normal = sample.surfaceNormal;
  const tangent = normalize(packet.tangentFrame.tangent.map((value, component) => (
    value - normal[component] * dot(packet.tangentFrame.tangent, normal)
  )));
  let bitangent = normalize(cross(normal, tangent));
  if (dot(bitangent, packet.tangentFrame.bitangent) < 0) {
    bitangent = bitangent.map((component) => -component);
  }
  const cosine = 0.72;
  const sine = Math.sqrt(1 - cosine * cosine);
  const directionAlong = (axis) => normalize(normal.map((value, component) => (
    value * cosine + axis[component] * sine
  )));
  const tangentDirection = directionAlong(tangent);
  const bitangentDirection = directionAlong(bitangent);
  const alongTangent = evaluateWoodFaceGgxResponseReference(sample, {
    viewDirection: tangentDirection,
    lightDirection: tangentDirection,
  });
  const alongBitangent = evaluateWoodFaceGgxResponseReference(sample, {
    viewDirection: bitangentDirection,
    lightDirection: bitangentDirection,
  });
  const swappedAxes = Object.freeze({
    ...sample,
    alphaX: sample.alphaY,
    alphaY: sample.alphaX,
  });
  const swappedAlongBitangent = evaluateWoodFaceGgxResponseReference(swappedAxes, {
    viewDirection: bitangentDirection,
    lightDirection: bitangentDirection,
  });

  assert.equal(alongTangent.kind, 'wood-cut-anisotropic-ggx-response:v1');
  assert.strictEqual(alongTangent.sourceSample, sample);
  for (const value of [
    alongTangent.distribution,
    alongTangent.maskingShadowing,
    alongTangent.fresnel,
    alongTangent.diffuseBrdf,
    alongTangent.specularBrdf,
  ]) {
    assert.ok(Number.isFinite(value) && value > 0);
  }
  assert.ok(alongTangent.maskingShadowing <= 1);
  assert.ok(alongTangent.fresnel >= 0.04 && alongTangent.fresnel <= 1);
  assert.ok(alongTangent.reflectedRgb.every((value) => (
    Number.isFinite(value) && value > 0
  )));
  assert.ok(Math.abs(
    alongTangent.specularBrdf - alongBitangent.specularBrdf
  ) > 1e-4);
  assert.ok(Math.abs(
    alongTangent.specularBrdf - swappedAlongBitangent.specularBrdf
  ) < 1e-10);
});

test('one complete wood face batches bounded anisotropic shading probes', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const triangle = 7;
  const barycentricSamples = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1 / 3, 1 / 3, 1 / 3],
  ];
  const viewDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.tangent[component] * 0.2
  )));
  const lightDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.bitangent[component] * 0.15
  )));
  const batch = evaluateWoodTriangleGgxBatchReference(packet, {
    triangle,
    barycentricSamples,
    viewDirection,
    lightDirection,
    sampleBudget: 4,
  });

  assert.equal(batch.kind, 'wood-cut-triangle-ggx-batch:v1');
  assert.strictEqual(batch.sourcePacket, packet);
  assert.equal(batch.triangle, triangle);
  assert.equal(batch.sampleCount, barycentricSamples.length);
  assert.equal(batch.sampleBudget, 4);
  assert.equal(batch.positions.length, batch.sampleCount * 3);
  assert.equal(batch.surfaceNormals.length, batch.sampleCount * 3);
  assert.equal(batch.specularBrdf.length, batch.sampleCount);
  assert.equal(batch.reflectedRgb.length, batch.sampleCount * 3);
  assert.equal(
    batch.vectorBytes,
    batch.positions.byteLength
      + batch.surfaceNormals.byteLength
      + batch.specularBrdf.byteLength
      + batch.reflectedRgb.byteLength,
  );

  barycentricSamples.forEach((barycentric, sampleIndex) => {
    const sample = sampleWoodMaterialTriangleReference(packet, {
      triangle,
      barycentric,
    });
    const response = evaluateWoodFaceGgxResponseReference(sample, {
      viewDirection,
      lightDirection,
    });
    assert.deepEqual(
      Array.from(batch.positions.subarray(sampleIndex * 3, sampleIndex * 3 + 3)),
      sample.position.map(Math.fround),
    );
    assert.deepEqual(
      Array.from(batch.surfaceNormals.subarray(sampleIndex * 3, sampleIndex * 3 + 3)),
      sample.surfaceNormal.map(Math.fround),
    );
    assert.equal(batch.specularBrdf[sampleIndex], Math.fround(response.specularBrdf));
    assert.deepEqual(
      Array.from(batch.reflectedRgb.subarray(sampleIndex * 3, sampleIndex * 3 + 3)),
      response.reflectedRgb.map(Math.fround),
    );
  });
});

test('one complete wood face covers a deterministic barycentric GGX lattice', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const triangle = 7;
  const subdivisions = 3;
  const sampleCount = 10;
  const viewDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.tangent[component] * 0.2
  )));
  const lightDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.bitangent[component] * 0.15
  )));
  const coverage = evaluateWoodTriangleGgxCoverageReference(packet, {
    triangle,
    subdivisions,
    viewDirection,
    lightDirection,
    sampleBudget: sampleCount,
  });
  const expectedBarycentric = [];
  for (let tangentStep = 0; tangentStep <= subdivisions; tangentStep += 1) {
    for (
      let bitangentStep = 0;
      bitangentStep <= subdivisions - tangentStep;
      bitangentStep += 1
    ) {
      expectedBarycentric.push([
        tangentStep / subdivisions,
        bitangentStep / subdivisions,
        (subdivisions - tangentStep - bitangentStep) / subdivisions,
      ]);
    }
  }
  const scalarBatch = evaluateWoodTriangleGgxBatchReference(packet, {
    triangle,
    barycentricSamples: expectedBarycentric,
    viewDirection,
    lightDirection,
    sampleBudget: sampleCount,
  });

  assert.equal(coverage.kind, 'wood-cut-triangle-ggx-coverage:v1');
  assert.strictEqual(coverage.sourcePacket, packet);
  assert.equal(coverage.triangle, triangle);
  assert.equal(coverage.subdivisions, subdivisions);
  assert.equal(coverage.sampleCount, sampleCount);
  assert.equal(coverage.sampleBudget, sampleCount);
  assert.deepEqual(
    Array.from(coverage.barycentricWeights),
    expectedBarycentric.flat().map(Math.fround),
  );
  assert.deepEqual(coverage.positions, scalarBatch.positions);
  assert.deepEqual(coverage.surfaceNormals, scalarBatch.surfaceNormals);
  assert.deepEqual(coverage.specularBrdf, scalarBatch.specularBrdf);
  assert.deepEqual(coverage.reflectedRgb, scalarBatch.reflectedRgb);
  assert.equal(
    coverage.vectorBytes,
    coverage.barycentricWeights.byteLength + scalarBatch.vectorBytes,
  );
  const corners = new Set([
    '1,0,0',
    '0,1,0',
    '0,0,1',
  ]);
  expectedBarycentric.forEach((weights) => corners.delete(weights.join(',')));
  assert.equal(corners.size, 0);
  assert.ok(expectedBarycentric.some((weights) => (
    weights.every((weight) => Math.abs(weight - 1 / 3) < 1e-12)
  )));
});

test('every complete wood face contributes one bounded anisotropic centroid response', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const viewDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.tangent[component] * 0.2
  )));
  const lightDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.bitangent[component] * 0.15
  )));
  const centroids = evaluateWoodMeshGgxCentroidsReference(packet, {
    viewDirection,
    lightDirection,
    triangleBudget: 32,
  });

  assert.equal(centroids.kind, 'wood-cut-mesh-ggx-centroids:v1');
  assert.strictEqual(centroids.sourcePacket, packet);
  assert.equal(centroids.triangleCount, packet.triangleCount);
  assert.equal(centroids.triangleBudget, 32);
  assert.deepEqual(centroids.barycentric, [1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(
    Array.from(centroids.triangleIndices),
    Array.from({ length: packet.triangleCount }, (_, triangle) => triangle),
  );
  assert.equal(centroids.positions.length, packet.triangleCount * 3);
  assert.equal(centroids.surfaceNormals.length, packet.triangleCount * 3);
  assert.equal(centroids.specularBrdf.length, packet.triangleCount);
  assert.equal(centroids.reflectedRgb.length, packet.triangleCount * 3);
  assert.equal(
    centroids.vectorBytes,
    centroids.triangleIndices.byteLength
      + centroids.positions.byteLength
      + centroids.surfaceNormals.byteLength
      + centroids.specularBrdf.byteLength
      + centroids.reflectedRgb.byteLength,
  );

  for (let triangle = 0; triangle < packet.triangleCount; triangle += 1) {
    const sample = sampleWoodMaterialTriangleReference(packet, {
      triangle,
      barycentric: centroids.barycentric,
    });
    const response = evaluateWoodFaceGgxResponseReference(sample, {
      viewDirection,
      lightDirection,
    });
    assert.deepEqual(
      Array.from(centroids.positions.subarray(triangle * 3, triangle * 3 + 3)),
      sample.position.map(Math.fround),
    );
    assert.deepEqual(
      Array.from(centroids.surfaceNormals.subarray(triangle * 3, triangle * 3 + 3)),
      sample.surfaceNormal.map(Math.fround),
    );
    assert.equal(centroids.specularBrdf[triangle], Math.fround(response.specularBrdf));
    assert.deepEqual(
      Array.from(centroids.reflectedRgb.subarray(triangle * 3, triangle * 3 + 3)),
      response.reflectedRgb.map(Math.fround),
    );
  }
});

function triangleArea(packet, triangle) {
  const points = [0, 1, 2].map((corner) => {
    const vertex = packet.indices[triangle * 3 + corner];
    return Array.from(packet.positions.subarray(vertex * 3, vertex * 3 + 3));
  });
  const firstEdge = points[1].map((value, component) => (
    value - points[0][component]
  ));
  const secondEdge = points[2].map((value, component) => (
    value - points[0][component]
  ));
  return Math.hypot(...cross(firstEdge, secondEdge)) * 0.5;
}

test('the complete wood mesh reduces to an area-weighted anisotropic response', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const viewDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.tangent[component] * 0.2
  )));
  const lightDirection = normalize(packet.tangentFrame.normal.map((value, component) => (
    value + packet.tangentFrame.bitangent[component] * 0.15
  )));
  const summary = evaluateWoodMeshGgxAreaSummaryReference(packet, {
    viewDirection,
    lightDirection,
    triangleBudget: 32,
  });
  const centroids = evaluateWoodMeshGgxCentroidsReference(packet, {
    viewDirection,
    lightDirection,
    triangleBudget: 32,
  });
  const expectedRgb = [0, 0, 0];
  let expectedArea = 0;
  let expectedSpecular = 0;
  for (let triangle = 0; triangle < packet.triangleCount; triangle += 1) {
    const area = triangleArea(packet, triangle);
    assert.equal(summary.triangleAreas[triangle], Math.fround(area));
    expectedArea += area;
    expectedSpecular += centroids.specularBrdf[triangle] * area;
    for (let channel = 0; channel < 3; channel += 1) {
      expectedRgb[channel] += centroids.reflectedRgb[triangle * 3 + channel] * area;
    }
  }
  expectedSpecular /= expectedArea;
  expectedRgb.forEach((_, channel) => {
    expectedRgb[channel] /= expectedArea;
  });

  assert.equal(summary.kind, 'wood-cut-mesh-ggx-area-summary:v1');
  assert.strictEqual(summary.sourcePacket, packet);
  assert.equal(summary.triangleCount, packet.triangleCount);
  assert.ok(Math.abs(summary.totalArea - expectedArea) < 1e-12);
  const authoredArea = (
    material.sourceSurface.sourceGrid.width * material.sourceSurface.sourceGrid.height
  );
  const retainedAreaDelta = Math.abs(summary.totalArea - authoredArea);
  assert.ok(
    retainedAreaDelta < Math.max(1e-6, authoredArea * 1e-3),
    `retained area delta ${retainedAreaDelta}`,
  );
  assert.ok(Math.abs(summary.meanSpecularBrdf - expectedSpecular) < 1e-12);
  summary.meanReflectedRgb.forEach((value, channel) => (
    assert.ok(Math.abs(value - expectedRgb[channel]) < 1e-12)
  ));
  assert.equal(
    summary.vectorBytes,
    summary.sourceCentroids.vectorBytes + summary.triangleAreas.byteLength,
  );
});

test('the complete wood mesh exposes a bounded tangent-oriented azimuth profile', () => {
  const material = proceduralSideGrainMaterial();
  const packet = adaptWoodCutMaterialToTriangleFacesReference(material, {
    triangleBudget: 32,
  });
  const azimuths = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const viewCosine = 0.72;
  const profile = evaluateWoodMeshGgxAzimuthProfileReference(packet, {
    azimuths,
    viewCosine,
    triangleBudget: 32,
    probeBudget: 4,
  });
  const viewSine = Math.sqrt(1 - viewCosine * viewCosine);
  const summaries = azimuths.map((azimuth) => {
    const direction = normalize(packet.tangentFrame.normal.map((normal, component) => (
      normal * viewCosine
      + packet.tangentFrame.tangent[component] * viewSine * Math.cos(azimuth)
      + packet.tangentFrame.bitangent[component] * viewSine * Math.sin(azimuth)
    )));
    return evaluateWoodMeshGgxAreaSummaryReference(packet, {
      viewDirection: direction,
      lightDirection: direction,
      triangleBudget: 32,
    });
  });

  assert.equal(profile.kind, 'wood-cut-mesh-ggx-azimuth-profile:v1');
  assert.strictEqual(profile.sourcePacket, packet);
  assert.equal(profile.probeCount, azimuths.length);
  assert.equal(profile.probeBudget, 4);
  assert.equal(profile.viewCosine, viewCosine);
  assert.deepEqual(Array.from(profile.azimuths), azimuths.map(Math.fround));
  assert.deepEqual(
    Array.from(profile.meanSpecularBrdf),
    summaries.map((summary) => Math.fround(summary.meanSpecularBrdf)),
  );
  assert.deepEqual(
    Array.from(profile.meanReflectedRgb),
    summaries.flatMap((summary) => summary.meanReflectedRgb.map(Math.fround)),
  );
  assert.ok(summaries.every((summary) => (
    Math.abs(summary.totalArea - profile.totalArea) < 1e-12
  )));
  assert.ok(Math.abs(
    profile.meanSpecularBrdf[0] - profile.meanSpecularBrdf[1]
  ) > 1e-4);
  assert.equal(
    profile.vectorBytes,
    profile.azimuths.byteLength
      + profile.meanSpecularBrdf.byteLength
      + profile.meanReflectedRgb.byteLength,
  );
});

test('coherent end-grain and side-grain cuts retain distinct bounded GGX profiles', () => {
  const packets = ['end-grain', 'side-grain'].map((orientation) => (
    adaptWoodCutMaterialToTriangleFacesReference(
      proceduralWoodMaterial(orientation),
      { triangleBudget: 32 },
    )
  ));
  const azimuths = [0, Math.PI / 2];
  const viewCosine = 0.72;
  const family = evaluateWoodOrientationGgxProfilesReference(packets, {
    azimuths,
    viewCosine,
    triangleBudget: 32,
    materialBudget: 2,
    probeBudget: 2,
  });
  const independent = packets.map((packet) => (
    evaluateWoodMeshGgxAzimuthProfileReference(packet, {
      azimuths,
      viewCosine,
      triangleBudget: 32,
      probeBudget: 2,
    })
  ));

  assert.equal(family.kind, 'wood-cut-orientation-ggx-profiles:v1');
  assert.deepEqual(family.sourcePackets, packets);
  assert.deepEqual(family.orientations, ['end-grain', 'side-grain']);
  assert.equal(family.materialCount, 2);
  assert.equal(family.materialBudget, 2);
  assert.equal(family.probeCount, 2);
  assert.equal(family.probeBudget, 2);
  assert.equal(family.viewCosine, viewCosine);
  assert.deepEqual(Array.from(family.azimuths), azimuths.map(Math.fround));
  assert.deepEqual(
    Array.from(family.meanSpecularBrdf),
    independent.flatMap((profile) => Array.from(profile.meanSpecularBrdf)),
  );
  assert.deepEqual(
    Array.from(family.meanReflectedRgb),
    independent.flatMap((profile) => Array.from(profile.meanReflectedRgb)),
  );
  let expectedMaximumDelta = 0;
  for (let probe = 0; probe < family.probeCount; probe += 1) {
    expectedMaximumDelta = Math.max(
      expectedMaximumDelta,
      Math.abs(
        family.meanSpecularBrdf[probe]
          - family.meanSpecularBrdf[family.probeCount + probe]
      ),
    );
  }
  assert.equal(family.maximumSpecularDelta, expectedMaximumDelta);
  assert.ok(family.maximumSpecularDelta > 1e-4);
  assert.equal(
    family.vectorBytes,
    family.azimuths.byteLength
      + family.meanSpecularBrdf.byteLength
      + family.meanReflectedRgb.byteLength,
  );
});

test('side-grain refinement levels retain distinct bounded GGX profiles', () => {
  const detailLevels = [0, 1, 2];
  const packets = detailLevels.map((detailLevel) => (
    adaptWoodCutMaterialToTriangleFacesReference(
      proceduralWoodMaterial('side-grain', detailLevel),
      { triangleBudget: 32 },
    )
  ));
  const azimuths = [0, Math.PI / 2];
  const viewCosine = 0.72;
  const refinements = evaluateWoodRefinementGgxProfilesReference(packets, {
    azimuths,
    viewCosine,
    triangleBudget: 32,
    refinementBudget: 3,
    probeBudget: 2,
  });
  const independent = packets.map((packet) => (
    evaluateWoodMeshGgxAzimuthProfileReference(packet, {
      azimuths,
      viewCosine,
      triangleBudget: 32,
      probeBudget: 2,
    })
  ));

  assert.equal(refinements.kind, 'wood-cut-refinement-ggx-profiles:v1');
  assert.deepEqual(refinements.sourcePackets, packets);
  assert.equal(refinements.orientation, 'side-grain');
  assert.equal(refinements.refinementCount, detailLevels.length);
  assert.equal(refinements.refinementBudget, 3);
  assert.deepEqual(Array.from(refinements.detailLevels), detailLevels);
  assert.equal(refinements.probeCount, 2);
  assert.equal(refinements.probeBudget, 2);
  assert.equal(refinements.viewCosine, viewCosine);
  assert.deepEqual(Array.from(refinements.azimuths), azimuths.map(Math.fround));
  assert.deepEqual(
    Array.from(refinements.meanSpecularBrdf),
    independent.flatMap((profile) => Array.from(profile.meanSpecularBrdf)),
  );
  assert.deepEqual(
    Array.from(refinements.meanReflectedRgb),
    independent.flatMap((profile) => Array.from(profile.meanReflectedRgb)),
  );
  let expectedMaximumDelta = 0;
  for (let refinement = 1; refinement < refinements.refinementCount; refinement += 1) {
    for (let probe = 0; probe < refinements.probeCount; probe += 1) {
      expectedMaximumDelta = Math.max(
        expectedMaximumDelta,
        Math.abs(
          refinements.meanSpecularBrdf[refinement * refinements.probeCount + probe]
            - refinements.meanSpecularBrdf[(refinement - 1) * refinements.probeCount + probe]
        ),
      );
    }
  }
  assert.equal(refinements.maximumAdjacentSpecularDelta, expectedMaximumDelta);
  assert.ok(refinements.maximumAdjacentSpecularDelta > 1e-5);
  assert.equal(
    refinements.vectorBytes,
    refinements.detailLevels.byteLength
      + refinements.azimuths.byteLength
      + refinements.meanSpecularBrdf.byteLength
      + refinements.meanReflectedRgb.byteLength,
  );
});

test('side-grain GGX profiles converge toward the finest retained refinement', () => {
  const detailLevels = [0, 1, 2];
  const packets = detailLevels.map((detailLevel) => (
    adaptWoodCutMaterialToTriangleFacesReference(
      proceduralWoodMaterial('side-grain', detailLevel),
      { triangleBudget: 32 },
    )
  ));
  const refinements = evaluateWoodRefinementGgxProfilesReference(packets, {
    azimuths: [0, Math.PI / 2],
    viewCosine: 0.72,
    triangleBudget: 32,
    refinementBudget: 3,
    probeBudget: 2,
  });
  const convergence = evaluateWoodRefinementGgxConvergenceReference(refinements);
  const reference = detailLevels.length - 1;
  const expectedSpecularError = detailLevels.map((_, refinement) => {
    let error = 0;
    for (let probe = 0; probe < refinements.probeCount; probe += 1) {
      error = Math.max(error, Math.abs(
        refinements.meanSpecularBrdf[refinement * refinements.probeCount + probe]
          - refinements.meanSpecularBrdf[reference * refinements.probeCount + probe]
      ));
    }
    return Math.fround(error);
  });
  const profileRgbLength = refinements.probeCount * 3;
  const expectedReflectedRgbError = detailLevels.map((_, refinement) => {
    let error = 0;
    for (let component = 0; component < profileRgbLength; component += 1) {
      error = Math.max(error, Math.abs(
        refinements.meanReflectedRgb[refinement * profileRgbLength + component]
          - refinements.meanReflectedRgb[reference * profileRgbLength + component]
      ));
    }
    return Math.fround(error);
  });

  assert.equal(convergence.kind, 'wood-cut-refinement-ggx-convergence:v1');
  assert.strictEqual(convergence.sourceProfiles, refinements);
  assert.equal(convergence.refinementCount, 3);
  assert.equal(convergence.referenceDetailLevel, 2);
  assert.deepEqual(
    Array.from(convergence.maximumSpecularError),
    expectedSpecularError,
  );
  assert.deepEqual(
    Array.from(convergence.maximumReflectedRgbError),
    expectedReflectedRgbError,
  );
  assert.equal(convergence.specularErrorStrictlyDecreases, true);
  assert.equal(convergence.reflectedRgbErrorStrictlyDecreases, true);
  assert.ok(convergence.maximumSpecularError[0] > 1e-3);
  assert.ok(convergence.maximumReflectedRgbError[0] > 1e-2);
  assert.equal(convergence.maximumSpecularError[reference], 0);
  assert.equal(convergence.maximumReflectedRgbError[reference], 0);
  assert.equal(
    convergence.vectorBytes,
    convergence.maximumSpecularError.byteLength
      + convergence.maximumReflectedRgbError.byteLength,
  );
});

test('quality budgets select the coarsest sufficient wood refinement', () => {
  const detailLevels = [0, 1, 2];
  const packets = detailLevels.map((detailLevel) => (
    adaptWoodCutMaterialToTriangleFacesReference(
      proceduralWoodMaterial('side-grain', detailLevel),
      { triangleBudget: 32 },
    )
  ));
  const refinements = evaluateWoodRefinementGgxProfilesReference(packets, {
    azimuths: [0, Math.PI / 2],
    viewCosine: 0.72,
    triangleBudget: 32,
    refinementBudget: 3,
    probeBudget: 2,
  });
  const convergence = evaluateWoodRefinementGgxConvergenceReference(refinements);
  const selections = detailLevels.map((_, refinement) => (
    selectWoodRefinementGgxProfileReference(convergence, {
      maximumSpecularError: convergence.maximumSpecularError[refinement],
      maximumReflectedRgbError: convergence.maximumReflectedRgbError[refinement],
    })
  ));

  assert.deepEqual(
    selections.map((selection) => selection.selectedRefinement),
    [0, 1, 2],
  );
  assert.deepEqual(
    selections.map((selection) => selection.selectedDetailLevel),
    detailLevels,
  );
  for (let selected = 0; selected < selections.length; selected += 1) {
    const selection = selections[selected];
    assert.equal(selection.kind, 'wood-cut-refinement-ggx-selection:v1');
    assert.strictEqual(selection.sourceConvergence, convergence);
    assert.strictEqual(selection.sourcePacket, packets[selected]);
    assert.equal(
      selection.specularError,
      convergence.maximumSpecularError[selected],
    );
    assert.equal(
      selection.reflectedRgbError,
      convergence.maximumReflectedRgbError[selected],
    );
    assert.ok(selection.specularError <= selection.maximumSpecularError);
    assert.ok(selection.reflectedRgbError <= selection.maximumReflectedRgbError);
    assert.equal(selection.vectorBytes, 0);
  }
});

test('bounded wood quality demands remain selection-order independent', () => {
  const detailLevels = [0, 1, 2];
  const packets = detailLevels.map((detailLevel) => (
    adaptWoodCutMaterialToTriangleFacesReference(
      proceduralWoodMaterial('side-grain', detailLevel),
      { triangleBudget: 32 },
    )
  ));
  const refinements = evaluateWoodRefinementGgxProfilesReference(packets, {
    azimuths: [0, Math.PI / 2],
    viewCosine: 0.72,
    triangleBudget: 32,
    refinementBudget: 3,
    probeBudget: 2,
  });
  const convergence = evaluateWoodRefinementGgxConvergenceReference(refinements);
  const demands = detailLevels.map((_, refinement) => Object.freeze({
    maximumSpecularError: convergence.maximumSpecularError[refinement],
    maximumReflectedRgbError:
      convergence.maximumReflectedRgbError[refinement],
  }));
  const canonical = selectWoodRefinementGgxProfileBatchReference(
    convergence,
    demands,
    { demandBudget: 3 },
  );
  const order = [2, 0, 1];
  const reordered = selectWoodRefinementGgxProfileBatchReference(
    convergence,
    order.map((index) => demands[index]),
    { demandBudget: 3 },
  );

  assert.equal(canonical.kind, 'wood-cut-refinement-ggx-selection-batch:v1');
  assert.strictEqual(canonical.sourceConvergence, convergence);
  assert.equal(canonical.demandCount, 3);
  assert.equal(canonical.demandBudget, 3);
  assert.deepEqual(Array.from(canonical.selectedRefinements), detailLevels);
  assert.deepEqual(Array.from(canonical.selectedDetailLevels), detailLevels);
  assert.deepEqual(canonical.sourcePackets, packets);
  assert.deepEqual(
    Array.from(reordered.selectedRefinements),
    order.map((index) => canonical.selectedRefinements[index]),
  );
  assert.deepEqual(
    Array.from(reordered.selectedDetailLevels),
    order.map((index) => canonical.selectedDetailLevels[index]),
  );
  assert.deepEqual(
    reordered.sourcePackets,
    order.map((index) => canonical.sourcePackets[index]),
  );
  assert.deepEqual(
    Array.from(reordered.specularErrors),
    order.map((index) => canonical.specularErrors[index]),
  );
  assert.deepEqual(
    Array.from(reordered.reflectedRgbErrors),
    order.map((index) => canonical.reflectedRgbErrors[index]),
  );
  assert.equal(
    canonical.vectorBytes,
    canonical.selectedRefinements.byteLength
      + canonical.selectedDetailLevels.byteLength
      + canonical.specularErrors.byteLength
      + canonical.reflectedRgbErrors.byteLength,
  );
  assert.throws(
    () => selectWoodRefinementGgxProfileBatchReference(
      convergence,
      demands,
      { demandBudget: 2 },
    ),
    /wood quality demands exceed demandBudget/,
  );
});
