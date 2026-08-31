/**
 * Target-independent clustered-light assignment.
 *
 * Bounds use normalized device x/y coordinates in [-1, 1] and positive view
 * depth. Cluster storage is x-fastest, then y, then logarithmic depth.
 */

import { projectLightViewBounds } from './vf-light-view-bounds.mjs';

// Keeps cluster offsets Uint32-representable while bounding the planner's
// fixed per-cluster bookkeeping well below an allocation-hostile size.
const MAX_SAFE_CLUSTER_COUNT = 1_048_576;

export function planClusteredLights({ grid, lights, maxLightsPerCluster }) {
  const normalizedGrid = normalizeGrid(grid);
  const capacity = positiveInteger(maxLightsPerCluster, 'maxLightsPerCluster');
  if (!Array.isArray(lights)) throw new TypeError('lights must be an array');

  const clusterCount = normalizedGrid.xSlices * normalizedGrid.ySlices * normalizedGrid.depthSlices;
  if (!Number.isSafeInteger(clusterCount) || clusterCount > MAX_SAFE_CLUSTER_COUNT) {
    throw new RangeError(`cluster count ${clusterCount} exceeds internal limit ${MAX_SAFE_CLUSTER_COUNT}`);
  }
  const clusterLightIds = Array.from({ length: clusterCount }, () => []);
  const overflowCounts = new Uint32Array(clusterCount);
  const orderedLights = lights.map(normalizeLight).sort((left, right) => left.id - right.id);
  assertUniqueIds(orderedLights);

  let culledLightCount = 0;
  let candidateAssignmentCount = 0;
  let overflowAssignmentCount = 0;
  for (const light of orderedLights) {
    const range = clusterRange(light.bounds, normalizedGrid);
    if (!range) {
      culledLightCount += 1;
      continue;
    }
    for (let depth = range.minDepth; depth <= range.maxDepth; depth += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (let x = range.minX; x <= range.maxX; x += 1) {
          const clusterIndex = (depth * normalizedGrid.ySlices + y) * normalizedGrid.xSlices + x;
          const ids = clusterLightIds[clusterIndex];
          candidateAssignmentCount += 1;
          if (ids.length < capacity) {
            ids.push(light.id);
          } else {
            overflowCounts[clusterIndex] += 1;
            overflowAssignmentCount += 1;
          }
        }
      }
    }
  }

  const clusterOffsets = new Uint32Array(clusterCount + 1);
  let assignmentCount = 0;
  for (let index = 0; index < clusterCount; index += 1) {
    clusterOffsets[index] = assignmentCount;
    assignmentCount += clusterLightIds[index].length;
  }
  clusterOffsets[clusterCount] = assignmentCount;

  const lightIds = new Uint32Array(assignmentCount);
  let cursor = 0;
  for (const ids of clusterLightIds) {
    lightIds.set(ids, cursor);
    cursor += ids.length;
  }

  let overflowClusterCount = 0;
  for (const count of overflowCounts) {
    if (count > 0) overflowClusterCount += 1;
  }

  return Object.freeze({
    clusterCount,
    clusterOffsets,
    lightIds,
    assignmentCount,
    candidateAssignmentCount,
    culledLightCount,
    overflowCounts,
    overflowAssignmentCount,
    overflowClusterCount
  });
}

export function planViewClusteredLights({ grid, camera, lights, maxLightsPerCluster }) {
  if (!grid || typeof grid !== 'object') throw new TypeError('grid must be an object');
  if (!camera || typeof camera !== 'object') throw new TypeError('camera must be an object');
  if (!Array.isArray(lights)) throw new TypeError('lights must be an array');
  const gridNear = Number(grid.nearDepth);
  const gridFar = Number(grid.farDepth);
  const cameraNear = Number(camera.nearDepth);
  const cameraFar = Number(camera.farDepth);
  if (gridNear !== cameraNear || gridFar !== cameraFar) {
    throw new RangeError('camera and grid depth ranges must match');
  }
  const projectedLights = lights.map(light => {
    const bounds = projectLightViewBounds(light, camera);
    return {
      id: light && light.id,
      kind: light && light.kind === 'geometry' ? 'projected' : light && light.kind,
      bounds: bounds ?? {
        minX: 2,
        maxX: 2,
        minY: 0,
        maxY: 0,
        minDepth: gridNear,
        maxDepth: gridNear
      }
    };
  });
  return planClusteredLights({ grid, lights: projectedLights, maxLightsPerCluster });
}

function normalizeGrid(grid) {
  if (!grid || typeof grid !== 'object') throw new TypeError('grid must be an object');
  const xSlices = positiveInteger(grid.xSlices, 'grid.xSlices');
  const ySlices = positiveInteger(grid.ySlices, 'grid.ySlices');
  const depthSlices = positiveInteger(grid.depthSlices, 'grid.depthSlices');
  const nearDepth = positiveFinite(grid.nearDepth, 'grid.nearDepth');
  const farDepth = positiveFinite(grid.farDepth, 'grid.farDepth');
  if (!(farDepth > nearDepth)) throw new RangeError('grid.farDepth must exceed grid.nearDepth');
  return { xSlices, ySlices, depthSlices, nearDepth, farDepth };
}

function normalizeLight(light) {
  if (!light || typeof light !== 'object') throw new TypeError('light must be an object');
  const id = uint32(light.id, 'light.id');
  if (light.kind !== 'point' && light.kind !== 'spot' && light.kind !== 'projected') {
    throw new TypeError('light.kind must be point, spot, or projected');
  }
  return { id, kind: light.kind, bounds: normalizeBounds(light.bounds) };
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') throw new TypeError('light.bounds must be an object');
  const result = {};
  for (const name of ['minX', 'maxX', 'minY', 'maxY', 'minDepth', 'maxDepth']) {
    const value = Number(bounds[name]);
    if (!Number.isFinite(value)) throw new TypeError(`light.bounds.${name} must be finite`);
    result[name] = value;
  }
  if (result.maxX < result.minX || result.maxY < result.minY || result.maxDepth < result.minDepth) {
    throw new RangeError('light bounds maxima must not be below minima');
  }
  return result;
}

function assertUniqueIds(lights) {
  for (let index = 1; index < lights.length; index += 1) {
    if (lights[index - 1].id === lights[index].id) {
      throw new RangeError(`duplicate light id ${lights[index].id}`);
    }
  }
}

function clusterRange(bounds, grid) {
  if (bounds.maxX < -1 || bounds.minX > 1 || bounds.maxY < -1 || bounds.minY > 1 ||
      bounds.maxDepth < grid.nearDepth || bounds.minDepth > grid.farDepth) return null;

  const minX = lowerLinearSlice(bounds.minX, grid.xSlices);
  const minY = lowerLinearSlice(bounds.minY, grid.ySlices);
  const minDepth = lowerDepthSlice(bounds.minDepth, grid);
  return {
    minX,
    maxX: Math.max(minX, upperLinearSlice(bounds.maxX, grid.xSlices)),
    minY,
    maxY: Math.max(minY, upperLinearSlice(bounds.maxY, grid.ySlices)),
    minDepth,
    maxDepth: Math.max(minDepth, upperDepthSlice(bounds.maxDepth, grid))
  };
}

function lowerLinearSlice(value, count) {
  return clamp(Math.floor(((value + 1) * 0.5) * count), 0, count - 1);
}

function upperLinearSlice(value, count) {
  return clamp(Math.ceil(((value + 1) * 0.5) * count) - 1, 0, count - 1);
}

function lowerDepthSlice(value, grid) {
  return clamp(Math.floor(depthCoordinate(value, grid)), 0, grid.depthSlices - 1);
}

function upperDepthSlice(value, grid) {
  return clamp(Math.ceil(depthCoordinate(value, grid)) - 1, 0, grid.depthSlices - 1);
}

function depthCoordinate(value, grid) {
  const clipped = clamp(value, grid.nearDepth, grid.farDepth);
  return Math.log(clipped / grid.nearDepth) / Math.log(grid.farDepth / grid.nearDepth) * grid.depthSlices;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive integer`);
  return number;
}

function positiveFinite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive and finite`);
  return number;
}

function uint32(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  }
  return number;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
