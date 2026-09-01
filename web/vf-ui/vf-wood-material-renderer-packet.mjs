const MAX_TRIANGLES = 131072;
const MAX_GGX_VERTICES = 65536;
const MAX_GGX_BATCH_SAMPLES = 4096;
const MAX_GGX_COVERAGE_SUBDIVISIONS = 89;
const MAX_GGX_MESH_TRIANGLES = 4096;
const MAX_GGX_AZIMUTH_PROBES = 64;
const MAX_GGX_MATERIAL_PROFILES = 4;
const REFERENCE_GGX_ANISOTROPY = 0.65;
const REFERENCE_GGX_MIN_ALPHA = 0.08;
const packetCache = new WeakMap();

function requireMaterial(material) {
  const surface = material?.sourceSurface;
  const grid = surface?.sourceGrid;
  const vertexCount = Number(material?.imageWidth) * Number(material?.imageHeight);
  const triangleCount = surface?.indices?.length / 3;
  if (
    !material
    || material.kind !== 'wood-cut-material-packet:v1'
    || !surface
    || surface.kind !== 'wood-cut-surface-packet:v1'
    || !grid
    || grid.kind !== 'wood-cut-plane-grid:v1'
    || !Number.isSafeInteger(vertexCount)
    || vertexCount <= 0
    || vertexCount !== grid.sampleCount
    || !(material.positions instanceof Float32Array)
    || material.positions.length !== vertexCount * 3
    || !(material.baseColors instanceof Float32Array)
    || material.baseColors.length !== vertexCount * 4
    || !(material.normalRgba8 instanceof Uint8ClampedArray)
    || material.normalRgba8.length !== vertexCount * 4
    || !(material.roughnessR8 instanceof Uint8Array)
    || material.roughnessR8.length !== vertexCount
    || !(surface.indices instanceof Uint32Array)
    || !Number.isSafeInteger(triangleCount)
    || triangleCount !== Math.max(0, grid.rows - 1) * Math.max(0, grid.columns - 1) * 2
    || !Array.isArray(grid.axisU)
    || grid.axisU.length !== 3
    || !Array.isArray(grid.axisV)
    || grid.axisV.length !== 3
    || !Array.isArray(surface.normal)
    || surface.normal.length !== 3
  ) {
    throw new TypeError('wood cut material with complete triangle surface is required');
  }
  if (vertexCount > MAX_GGX_VERTICES) {
    throw new RangeError(
      `wood cut material exceeds GGX vertex capacity ${MAX_GGX_VERTICES}`,
    );
  }
  for (let index = 0; index < surface.indices.length; index += 1) {
    if (surface.indices[index] >= vertexCount) {
      throw new RangeError(`triangle index ${index} must reference a retained vertex`);
    }
  }
  return { surface, grid, vertexCount, triangleCount };
}

function requireBudget(triangleBudget, triangleCount) {
  if (
    !Number.isSafeInteger(triangleBudget)
    || triangleBudget < 0
    || triangleBudget > MAX_TRIANGLES
  ) {
    throw new RangeError(
      `wood triangleBudget must be an integer from 0 to ${MAX_TRIANGLES}`,
    );
  }
  if (triangleCount > triangleBudget) {
    throw new RangeError('wood cut material exceeds triangleBudget');
  }
}

function realizeAnisotropicGgxLobe(material, vertexCount) {
  const alphaX = new Float32Array(vertexCount);
  const alphaY = new Float32Array(vertexCount);
  const aspect = Math.sqrt(1 - 0.9 * REFERENCE_GGX_ANISOTROPY);
  for (let sample = 0; sample < vertexCount; sample += 1) {
    const perceptualRoughness = material.roughnessR8[sample] / 255;
    const alpha = Math.max(
      REFERENCE_GGX_MIN_ALPHA,
      perceptualRoughness * perceptualRoughness,
    );
    alphaX[sample] = alpha / aspect;
    alphaY[sample] = alpha * aspect;
  }
  return Object.freeze({
    kind: 'wood-cut-anisotropic-ggx-lobe:v1',
    anisotropy: REFERENCE_GGX_ANISOTROPY,
    axisOrder: Object.freeze(['tangent', 'bitangent']),
    alphaX,
    alphaY,
    vectorBytes: alphaX.byteLength + alphaY.byteLength,
  });
}

export function adaptWoodCutMaterialToTriangleFacesReference(
  material,
  { triangleBudget },
) {
  const { surface, grid, vertexCount, triangleCount } = requireMaterial(material);
  requireBudget(triangleBudget, triangleCount);
  const retained = packetCache.get(material);
  if (retained) return retained;

  const packet = Object.freeze({
    kind: 'wood-cut-material-triangle-packet:v1',
    sourceMaterial: material,
    vertexCount,
    triangleCount,
    positions: material.positions,
    indices: surface.indices,
    baseColors: material.baseColors,
    normalRgba8: material.normalRgba8,
    roughnessR8: material.roughnessR8,
    tangentFrame: Object.freeze({
      tangent: grid.axisU,
      bitangent: grid.axisV,
      normal: surface.normal,
      handedness: 1,
    }),
    ggxLobe: realizeAnisotropicGgxLobe(material, vertexCount),
  });
  packetCache.set(material, packet);
  return packet;
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((component) => component / length);
}

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

function interpolate(values, components, vertexIndices, barycentric) {
  return Array.from({ length: components }, (_, component) => (
    vertexIndices.reduce((sum, vertex, corner) => (
      sum + values[vertex * components + component] * barycentric[corner]
    ), 0)
  ));
}

export function sampleWoodMaterialTriangleReference(
  packet,
  { triangle, barycentric },
) {
  if (!packet || packet.kind !== 'wood-cut-material-triangle-packet:v1') {
    throw new TypeError('wood cut material triangle packet is required');
  }
  if (
    !Number.isSafeInteger(triangle)
    || triangle < 0
    || triangle >= packet.triangleCount
  ) {
    throw new RangeError('wood material triangle must reference a complete face');
  }
  if (
    !Array.isArray(barycentric)
    || barycentric.length !== 3
    || barycentric.some((weight) => !Number.isFinite(weight) || weight < 0)
    || Math.abs(barycentric.reduce((sum, weight) => sum + weight, 0) - 1) > 1e-12
  ) {
    throw new RangeError('wood material barycentric weights must be finite, non-negative, and sum to one');
  }

  const vertexIndices = Array.from(packet.indices.subarray(
    triangle * 3,
    triangle * 3 + 3,
  ));
  const decodedNormals = new Float64Array(9);
  vertexIndices.forEach((vertex, corner) => {
    const encodedOffset = vertex * 4;
    const tangentNormal = normalize([0, 1, 2].map((component) => (
      packet.normalRgba8[encodedOffset + component] / 127.5 - 1
    )));
    decodedNormals.set(tangentNormal, corner * 3);
  });
  const localIndices = [0, 1, 2];
  const tangentNormal = normalize(interpolate(
    decodedNormals,
    3,
    localIndices,
    barycentric,
  ));
  const surfaceNormal = normalize([0, 1, 2].map((component) => (
    packet.tangentFrame.tangent[component] * tangentNormal[0]
    + packet.tangentFrame.bitangent[component] * tangentNormal[1]
    + packet.tangentFrame.normal[component] * tangentNormal[2]
  )));

  return Object.freeze({
    kind: 'wood-cut-anisotropic-face-sample:v1',
    sourcePacket: packet,
    triangle,
    vertexIndices: Object.freeze(vertexIndices),
    barycentric: Object.freeze(Array.from(barycentric)),
    position: Object.freeze(interpolate(
      packet.positions,
      3,
      vertexIndices,
      barycentric,
    )),
    baseColor: Object.freeze(interpolate(
      packet.baseColors,
      4,
      vertexIndices,
      barycentric,
    )),
    surfaceNormal: Object.freeze(surfaceNormal),
    alphaX: interpolate(
      packet.ggxLobe.alphaX,
      1,
      vertexIndices,
      barycentric,
    )[0],
    alphaY: interpolate(
      packet.ggxLobe.alphaY,
      1,
      vertexIndices,
      barycentric,
    )[0],
  });
}

function requireDirection(value, name) {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((component) => !Number.isFinite(component))
    || !(Math.hypot(...value) > 1e-12)
  ) {
    throw new RangeError(`${name} must be a finite non-zero vector`);
  }
  return normalize(value);
}

function ggxLambda(x, y, z, alphaX, alphaY) {
  return (
    Math.sqrt(1 + (
      alphaX * alphaX * x * x
      + alphaY * alphaY * y * y
    ) / (z * z)) - 1
  ) * 0.5;
}

export function evaluateWoodFaceGgxResponseReference(
  sample,
  { viewDirection: viewValue, lightDirection: lightValue },
) {
  if (
    !sample
    || sample.kind !== 'wood-cut-anisotropic-face-sample:v1'
    || !sample.sourcePacket?.tangentFrame
    || !Array.isArray(sample.surfaceNormal)
    || !Array.isArray(sample.baseColor)
    || !(sample.alphaX > 0)
    || !(sample.alphaY > 0)
  ) {
    throw new TypeError('wood cut anisotropic face sample is required');
  }
  const normal = sample.surfaceNormal;
  const sourceFrame = sample.sourcePacket.tangentFrame;
  const tangent = normalize(sourceFrame.tangent.map((value, component) => (
    value - normal[component] * dot(sourceFrame.tangent, normal)
  )));
  let bitangent = normalize(cross(normal, tangent));
  if (dot(bitangent, sourceFrame.bitangent) < 0) {
    bitangent = bitangent.map((component) => -component);
  }
  const view = requireDirection(viewValue, 'wood GGX viewDirection');
  const light = requireDirection(lightValue, 'wood GGX lightDirection');
  const viewZ = dot(view, normal);
  const lightZ = dot(light, normal);
  if (!(viewZ > 1e-8) || !(lightZ > 1e-8)) {
    throw new RangeError('wood GGX directions must lie above the sampled face');
  }
  const halfway = normalize(view.map((value, component) => (
    value + light[component]
  )));
  const local = (direction) => [
    dot(direction, tangent),
    dot(direction, bitangent),
    dot(direction, normal),
  ];
  const [viewX, viewY] = local(view);
  const [lightX, lightY] = local(light);
  const [halfX, halfY, halfZ] = local(halfway);
  const scaledHalfLengthSquared = (
    halfX * halfX / (sample.alphaX * sample.alphaX)
    + halfY * halfY / (sample.alphaY * sample.alphaY)
    + halfZ * halfZ
  );
  const distribution = 1 / (
    Math.PI
    * sample.alphaX
    * sample.alphaY
    * scaledHalfLengthSquared
    * scaledHalfLengthSquared
  );
  const maskingShadowing = 1 / (
    1
    + ggxLambda(viewX, viewY, viewZ, sample.alphaX, sample.alphaY)
    + ggxLambda(lightX, lightY, lightZ, sample.alphaX, sample.alphaY)
  );
  const viewHalf = Math.max(0, dot(view, halfway));
  const fresnel = 0.04 + 0.96 * ((1 - viewHalf) ** 5);
  const specularBrdf = (
    distribution
    * maskingShadowing
    * fresnel
    / (4 * viewZ * lightZ)
  );
  const diffuseBrdf = (1 - fresnel) / Math.PI;
  const reflectedRgb = sample.baseColor.slice(0, 3).map((baseColor) => (
    (baseColor * diffuseBrdf + specularBrdf) * lightZ
  ));

  return Object.freeze({
    kind: 'wood-cut-anisotropic-ggx-response:v1',
    sourceSample: sample,
    distribution,
    maskingShadowing,
    fresnel,
    diffuseBrdf,
    specularBrdf,
    reflectedRgb: Object.freeze(reflectedRgb),
  });
}

export function evaluateWoodTriangleGgxBatchReference(
  packet,
  {
    triangle,
    barycentricSamples,
    viewDirection,
    lightDirection,
    sampleBudget,
  },
) {
  if (!Array.isArray(barycentricSamples)) {
    throw new TypeError('wood GGX barycentricSamples must be an array');
  }
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_GGX_BATCH_SAMPLES
  ) {
    throw new RangeError(
      `wood GGX sampleBudget must be an integer from 0 to ${MAX_GGX_BATCH_SAMPLES}`,
    );
  }
  const sampleCount = barycentricSamples.length;
  if (sampleCount > sampleBudget) {
    throw new RangeError('wood triangle GGX batch exceeds sampleBudget');
  }

  const positions = new Float32Array(sampleCount * 3);
  const surfaceNormals = new Float32Array(sampleCount * 3);
  const specularBrdf = new Float32Array(sampleCount);
  const reflectedRgb = new Float32Array(sampleCount * 3);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sample = sampleWoodMaterialTriangleReference(packet, {
      triangle,
      barycentric: barycentricSamples[sampleIndex],
    });
    const response = evaluateWoodFaceGgxResponseReference(sample, {
      viewDirection,
      lightDirection,
    });
    positions.set(sample.position, sampleIndex * 3);
    surfaceNormals.set(sample.surfaceNormal, sampleIndex * 3);
    specularBrdf[sampleIndex] = response.specularBrdf;
    reflectedRgb.set(response.reflectedRgb, sampleIndex * 3);
  }

  return Object.freeze({
    kind: 'wood-cut-triangle-ggx-batch:v1',
    sourcePacket: packet,
    triangle,
    sampleCount,
    sampleBudget,
    positions,
    surfaceNormals,
    specularBrdf,
    reflectedRgb,
    vectorBytes: positions.byteLength
      + surfaceNormals.byteLength
      + specularBrdf.byteLength
      + reflectedRgb.byteLength,
  });
}

export function evaluateWoodTriangleGgxCoverageReference(
  packet,
  {
    triangle,
    subdivisions,
    viewDirection,
    lightDirection,
    sampleBudget,
  },
) {
  if (
    !Number.isSafeInteger(subdivisions)
    || subdivisions < 1
    || subdivisions > MAX_GGX_COVERAGE_SUBDIVISIONS
  ) {
    throw new RangeError(
      `wood GGX subdivisions must be an integer from 1 to ${MAX_GGX_COVERAGE_SUBDIVISIONS}`,
    );
  }
  if (
    !Number.isSafeInteger(sampleBudget)
    || sampleBudget < 0
    || sampleBudget > MAX_GGX_BATCH_SAMPLES
  ) {
    throw new RangeError(
      `wood GGX sampleBudget must be an integer from 0 to ${MAX_GGX_BATCH_SAMPLES}`,
    );
  }
  const sampleCount = (subdivisions + 1) * (subdivisions + 2) / 2;
  if (sampleCount > sampleBudget) {
    throw new RangeError('wood triangle GGX coverage exceeds sampleBudget');
  }

  const barycentricSamples = [];
  const barycentricWeights = new Float32Array(sampleCount * 3);
  let sampleIndex = 0;
  for (let tangentStep = 0; tangentStep <= subdivisions; tangentStep += 1) {
    for (
      let bitangentStep = 0;
      bitangentStep <= subdivisions - tangentStep;
      bitangentStep += 1
    ) {
      const barycentric = [
        tangentStep / subdivisions,
        bitangentStep / subdivisions,
        (subdivisions - tangentStep - bitangentStep) / subdivisions,
      ];
      barycentricSamples.push(barycentric);
      barycentricWeights.set(barycentric, sampleIndex * 3);
      sampleIndex += 1;
    }
  }
  const batch = evaluateWoodTriangleGgxBatchReference(packet, {
    triangle,
    barycentricSamples,
    viewDirection,
    lightDirection,
    sampleBudget,
  });

  return Object.freeze({
    kind: 'wood-cut-triangle-ggx-coverage:v1',
    sourcePacket: packet,
    triangle,
    subdivisions,
    sampleCount,
    sampleBudget,
    barycentricWeights,
    positions: batch.positions,
    surfaceNormals: batch.surfaceNormals,
    specularBrdf: batch.specularBrdf,
    reflectedRgb: batch.reflectedRgb,
    vectorBytes: barycentricWeights.byteLength + batch.vectorBytes,
  });
}

export function evaluateWoodMeshGgxCentroidsReference(
  packet,
  { viewDirection, lightDirection, triangleBudget },
) {
  if (
    !packet
    || packet.kind !== 'wood-cut-material-triangle-packet:v1'
    || !Number.isSafeInteger(packet.triangleCount)
    || packet.triangleCount < 0
  ) {
    throw new TypeError('wood cut material triangle packet is required');
  }
  if (
    !Number.isSafeInteger(triangleBudget)
    || triangleBudget < 0
    || triangleBudget > MAX_GGX_MESH_TRIANGLES
  ) {
    throw new RangeError(
      `wood mesh triangleBudget must be an integer from 0 to ${MAX_GGX_MESH_TRIANGLES}`,
    );
  }
  const triangleCount = packet.triangleCount;
  if (triangleCount > triangleBudget) {
    throw new RangeError('wood mesh GGX centroids exceed triangleBudget');
  }

  const barycentric = Object.freeze([1 / 3, 1 / 3, 1 / 3]);
  const triangleIndices = new Uint32Array(triangleCount);
  const positions = new Float32Array(triangleCount * 3);
  const surfaceNormals = new Float32Array(triangleCount * 3);
  const specularBrdf = new Float32Array(triangleCount);
  const reflectedRgb = new Float32Array(triangleCount * 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const sample = sampleWoodMaterialTriangleReference(packet, {
      triangle,
      barycentric,
    });
    const response = evaluateWoodFaceGgxResponseReference(sample, {
      viewDirection,
      lightDirection,
    });
    triangleIndices[triangle] = triangle;
    positions.set(sample.position, triangle * 3);
    surfaceNormals.set(sample.surfaceNormal, triangle * 3);
    specularBrdf[triangle] = response.specularBrdf;
    reflectedRgb.set(response.reflectedRgb, triangle * 3);
  }

  return Object.freeze({
    kind: 'wood-cut-mesh-ggx-centroids:v1',
    sourcePacket: packet,
    triangleCount,
    triangleBudget,
    barycentric,
    triangleIndices,
    positions,
    surfaceNormals,
    specularBrdf,
    reflectedRgb,
    vectorBytes: triangleIndices.byteLength
      + positions.byteLength
      + surfaceNormals.byteLength
      + specularBrdf.byteLength
      + reflectedRgb.byteLength,
  });
}

function retainedTriangleArea(packet, triangle) {
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

export function evaluateWoodMeshGgxAreaSummaryReference(
  packet,
  { viewDirection, lightDirection, triangleBudget },
) {
  const sourceCentroids = evaluateWoodMeshGgxCentroidsReference(packet, {
    viewDirection,
    lightDirection,
    triangleBudget,
  });
  const triangleCount = sourceCentroids.triangleCount;
  const triangleAreas = new Float32Array(triangleCount);
  const reflectedSum = [0, 0, 0];
  let totalArea = 0;
  let specularSum = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const area = retainedTriangleArea(packet, triangle);
    if (!Number.isFinite(area) || !(area > 0)) {
      throw new RangeError(`wood mesh triangle ${triangle} must have positive finite area`);
    }
    triangleAreas[triangle] = area;
    totalArea += area;
    specularSum += sourceCentroids.specularBrdf[triangle] * area;
    for (let channel = 0; channel < 3; channel += 1) {
      reflectedSum[channel] += (
        sourceCentroids.reflectedRgb[triangle * 3 + channel] * area
      );
    }
  }

  return Object.freeze({
    kind: 'wood-cut-mesh-ggx-area-summary:v1',
    sourcePacket: packet,
    sourceCentroids,
    triangleCount,
    triangleAreas,
    totalArea,
    meanSpecularBrdf: specularSum / totalArea,
    meanReflectedRgb: Object.freeze(reflectedSum.map((value) => value / totalArea)),
    vectorBytes: sourceCentroids.vectorBytes + triangleAreas.byteLength,
  });
}

export function evaluateWoodMeshGgxAzimuthProfileReference(
  packet,
  { azimuths: azimuthValues, viewCosine, triangleBudget, probeBudget },
) {
  if (
    !packet
    || packet.kind !== 'wood-cut-material-triangle-packet:v1'
    || !packet.tangentFrame
  ) {
    throw new TypeError('wood cut material triangle packet is required');
  }
  if (
    !Array.isArray(azimuthValues)
    || azimuthValues.length === 0
    || azimuthValues.some((azimuth) => !Number.isFinite(azimuth))
  ) {
    throw new RangeError('wood GGX azimuths must contain finite probes');
  }
  if (
    !Number.isSafeInteger(probeBudget)
    || probeBudget < 0
    || probeBudget > MAX_GGX_AZIMUTH_PROBES
  ) {
    throw new RangeError(
      `wood GGX probeBudget must be an integer from 0 to ${MAX_GGX_AZIMUTH_PROBES}`,
    );
  }
  const probeCount = azimuthValues.length;
  if (probeCount > probeBudget) {
    throw new RangeError('wood mesh GGX azimuth profile exceeds probeBudget');
  }
  if (!Number.isFinite(viewCosine) || !(viewCosine > 0) || viewCosine > 1) {
    throw new RangeError('wood GGX viewCosine must be finite in (0,1]');
  }

  const azimuths = new Float32Array(probeCount);
  const meanSpecularBrdf = new Float32Array(probeCount);
  const meanReflectedRgb = new Float32Array(probeCount * 3);
  const viewSine = Math.sqrt(1 - viewCosine * viewCosine);
  let totalArea = 0;
  for (let probe = 0; probe < probeCount; probe += 1) {
    const azimuth = azimuthValues[probe];
    const direction = normalize(packet.tangentFrame.normal.map((normal, component) => (
      normal * viewCosine
      + packet.tangentFrame.tangent[component] * viewSine * Math.cos(azimuth)
      + packet.tangentFrame.bitangent[component] * viewSine * Math.sin(azimuth)
    )));
    const summary = evaluateWoodMeshGgxAreaSummaryReference(packet, {
      viewDirection: direction,
      lightDirection: direction,
      triangleBudget,
    });
    if (probe === 0) totalArea = summary.totalArea;
    azimuths[probe] = azimuth;
    meanSpecularBrdf[probe] = summary.meanSpecularBrdf;
    meanReflectedRgb.set(summary.meanReflectedRgb, probe * 3);
  }

  return Object.freeze({
    kind: 'wood-cut-mesh-ggx-azimuth-profile:v1',
    sourcePacket: packet,
    probeCount,
    probeBudget,
    viewCosine,
    totalArea,
    azimuths,
    meanSpecularBrdf,
    meanReflectedRgb,
    vectorBytes: azimuths.byteLength
      + meanSpecularBrdf.byteLength
      + meanReflectedRgb.byteLength,
  });
}

export function evaluateWoodOrientationGgxProfilesReference(
  packetValues,
  {
    azimuths: azimuthValues,
    viewCosine,
    triangleBudget,
    materialBudget,
    probeBudget,
  },
) {
  if (!Array.isArray(packetValues) || packetValues.length === 0) {
    throw new TypeError('wood orientation profiles require material packets');
  }
  if (
    !Number.isSafeInteger(materialBudget)
    || materialBudget < 0
    || materialBudget > MAX_GGX_MATERIAL_PROFILES
  ) {
    throw new RangeError(
      `wood materialBudget must be an integer from 0 to ${MAX_GGX_MATERIAL_PROFILES}`,
    );
  }
  const materialCount = packetValues.length;
  if (materialCount > materialBudget) {
    throw new RangeError('wood orientation profiles exceed materialBudget');
  }
  const probeCount = Array.isArray(azimuthValues) ? azimuthValues.length : 0;
  const azimuths = new Float32Array(probeCount);
  const meanSpecularBrdf = new Float32Array(materialCount * probeCount);
  const meanReflectedRgb = new Float32Array(materialCount * probeCount * 3);
  const orientations = [];
  for (let material = 0; material < materialCount; material += 1) {
    const packet = packetValues[material];
    const profile = evaluateWoodMeshGgxAzimuthProfileReference(packet, {
      azimuths: azimuthValues,
      viewCosine,
      triangleBudget,
      probeBudget,
    });
    if (material === 0) azimuths.set(profile.azimuths);
    orientations.push(String(packet.sourceMaterial?.orientation || ''));
    meanSpecularBrdf.set(profile.meanSpecularBrdf, material * probeCount);
    meanReflectedRgb.set(profile.meanReflectedRgb, material * probeCount * 3);
  }
  let maximumSpecularDelta = 0;
  for (let left = 0; left < materialCount; left += 1) {
    for (let right = left + 1; right < materialCount; right += 1) {
      for (let probe = 0; probe < probeCount; probe += 1) {
        maximumSpecularDelta = Math.max(
          maximumSpecularDelta,
          Math.abs(
            meanSpecularBrdf[left * probeCount + probe]
              - meanSpecularBrdf[right * probeCount + probe]
          ),
        );
      }
    }
  }

  return Object.freeze({
    kind: 'wood-cut-orientation-ggx-profiles:v1',
    sourcePackets: Object.freeze(Array.from(packetValues)),
    orientations: Object.freeze(orientations),
    materialCount,
    materialBudget,
    probeCount,
    probeBudget,
    viewCosine,
    azimuths,
    meanSpecularBrdf,
    meanReflectedRgb,
    maximumSpecularDelta,
    vectorBytes: azimuths.byteLength
      + meanSpecularBrdf.byteLength
      + meanReflectedRgb.byteLength,
  });
}
