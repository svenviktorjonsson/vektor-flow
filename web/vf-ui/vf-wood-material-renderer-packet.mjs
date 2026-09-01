const MAX_TRIANGLES = 131072;
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
  });
  packetCache.set(material, packet);
  return packet;
}
