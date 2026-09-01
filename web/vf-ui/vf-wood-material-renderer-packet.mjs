const MAX_TRIANGLES = 131072;
const MAX_GGX_VERTICES = 65536;
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
