const MAX_TREE_BUDGET = 4096;
const MAX_PRIMITIVE_BUDGET = 65536;
const COARSE_PRIMITIVES = 2;
const BRANCH_PRIMITIVES = 4;
const FOLIAGE_PRIMITIVES = 16;
const BRANCH_PIXEL_THRESHOLD = 24;
const FOLIAGE_PIXEL_THRESHOLD = 96;

function requireVector3(value, name) {
  const typed = ArrayBuffer.isView(value) && !(value instanceof DataView);
  if ((!Array.isArray(value) && !typed) || value.length !== 3) {
    throw new TypeError(`${name} must contain exactly three numbers`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (typeof value[axis] !== 'number' || !Number.isFinite(value[axis])) {
      throw new RangeError(`${name}[${axis}] must be finite`);
    }
  }
}

function requirePositive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    throw new RangeError(`${name} must be finite and positive`);
  }
}

function requireBudget(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}`);
  }
}

function requireForest(forest) {
  if (
    !forest
    || forest.kind !== 'forest-patch-working-set:v1'
    || !Number.isSafeInteger(forest.treeCount)
    || forest.treeCount < 0
    || !Array.isArray(forest.treeIds)
    || forest.treeIds.length !== forest.treeCount
    || !(forest.positions instanceof Float32Array)
    || forest.positions.length !== forest.treeCount * 3
    || !(forest.growth instanceof Float32Array)
    || forest.growth.length !== forest.treeCount * 4
  ) {
    throw new TypeError('forest patch working set is required');
  }
}

function subtract(first, second) {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  ];
}

function dot(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function normalize(vector, name) {
  const length = Math.sqrt(dot(vector, vector));
  if (!(length > 1e-12)) throw new RangeError(`${name} must be non-zero`);
  return vector.map((value) => value / length);
}

function cameraBasis(camera) {
  if (!camera || typeof camera !== 'object') {
    throw new TypeError('tree view camera is required');
  }
  requireVector3(camera.eye, 'tree view camera eye');
  requireVector3(camera.target, 'tree view camera target');
  requireVector3(camera.up, 'tree view camera up');
  requirePositive(camera.viewportWidth, 'tree view viewport width');
  requirePositive(camera.viewportHeight, 'tree view viewport height');
  if (
    typeof camera.verticalFovRadians !== 'number'
    || !Number.isFinite(camera.verticalFovRadians)
    || !(camera.verticalFovRadians > 0)
    || !(camera.verticalFovRadians < Math.PI)
  ) {
    throw new RangeError('tree view vertical FOV must be between 0 and pi');
  }
  if (camera.maximumDistance != null) {
    requirePositive(camera.maximumDistance, 'tree view maximum distance');
  }
  const forward = normalize(subtract(camera.target, camera.eye), 'tree view direction');
  const right = normalize(cross(forward, camera.up), 'tree view camera up cross direction');
  const up = cross(right, forward);
  const verticalTangent = Math.tan(camera.verticalFovRadians / 2);
  return Object.freeze({
    forward,
    right,
    up,
    verticalTangent,
    horizontalTangent: verticalTangent * camera.viewportWidth / camera.viewportHeight,
    focalPixels: camera.viewportHeight / (2 * verticalTangent),
    maximumDistance: camera.maximumDistance ?? Infinity,
  });
}

function classifyTree(forest, treeIndex, camera, basis) {
  const positionOffset = treeIndex * 3;
  const growthOffset = treeIndex * 4;
  const height = forest.growth[growthOffset + 1];
  const crownRadius = forest.growth[growthOffset + 2];
  const center = [
    forest.positions[positionOffset],
    forest.positions[positionOffset + 1],
    forest.positions[positionOffset + 2] + height / 2,
  ];
  const radius = Math.hypot(height / 2, crownRadius);
  const relative = subtract(center, camera.eye);
  const depth = dot(relative, basis.forward);
  if (depth + radius <= 0 || depth - radius > basis.maximumDistance) return null;
  const horizontal = dot(relative, basis.right);
  const vertical = dot(relative, basis.up);
  const projectionDepth = Math.max(depth, 1e-6);
  if (Math.abs(horizontal) > projectionDepth * basis.horizontalTangent + radius) return null;
  if (Math.abs(vertical) > projectionDepth * basis.verticalTangent + radius) return null;
  const nearestDepth = Math.max(0.25, depth - radius);
  const projectedPixels = 2 * radius * basis.focalPixels / nearestDepth;
  const detailLevel = projectedPixels >= FOLIAGE_PIXEL_THRESHOLD
    ? 2
    : projectedPixels >= BRANCH_PIXEL_THRESHOLD ? 1 : 0;
  return { treeIndex, detailLevel, projectedPixels, depth };
}

function candidateCompare(first, second) {
  return second.projectedPixels - first.projectedPixels
    || first.depth - second.depth
    || first.treeIndex - second.treeIndex;
}

function emptyDemand(treeBudget, primitiveBudget) {
  return Object.freeze({
    kind: 'tree-view-demand:v1',
    treeIndices: new Uint32Array(0),
    detailLevels: new Uint8Array(0),
    primitiveBudget,
    plannedPrimitiveCount: 0,
    vectorBytes: 0,
    treeBudget,
    scannedTreeCount: 0,
    visibleTreeCount: 0,
    culledTreeCount: 0,
    truncated: false,
  });
}

export function selectTreeViewDemandReference({
  camera,
  forest,
  treeBudget,
  primitiveBudget,
}) {
  requireForest(forest);
  requireBudget(treeBudget, 'treeBudget', MAX_TREE_BUDGET);
  requireBudget(primitiveBudget, 'primitiveBudget', MAX_PRIMITIVE_BUDGET);
  const basis = cameraBasis(camera);
  if (treeBudget === 0 || primitiveBudget < COARSE_PRIMITIVES || forest.treeCount === 0) {
    return emptyDemand(treeBudget, primitiveBudget);
  }

  const visible = [];
  for (let treeIndex = 0; treeIndex < forest.treeCount; treeIndex += 1) {
    const candidate = classifyTree(forest, treeIndex, camera, basis);
    if (candidate) visible.push(candidate);
  }
  visible.sort(candidateCompare);
  const selectedCount = Math.min(
    visible.length,
    treeBudget,
    Math.floor(primitiveBudget / COARSE_PRIMITIVES),
  );
  const selected = visible.slice(0, selectedCount);
  const levels = new Uint8Array(selectedCount);
  let remaining = primitiveBudget - selectedCount * COARSE_PRIMITIVES;

  for (let index = 0; index < selected.length && remaining >= BRANCH_PRIMITIVES; index += 1) {
    if (selected[index].detailLevel >= 1) {
      levels[index] = 1;
      remaining -= BRANCH_PRIMITIVES;
    }
  }
  for (let index = 0; index < selected.length && remaining >= FOLIAGE_PRIMITIVES; index += 1) {
    if (selected[index].detailLevel >= 2 && levels[index] === 1) {
      levels[index] = 2;
      remaining -= FOLIAGE_PRIMITIVES;
    }
  }

  const byIndex = selected.map((candidate, rank) => ({
    ...candidate,
    wantedDetailLevel: candidate.detailLevel,
    detailLevel: levels[rank],
  })).sort((first, second) => first.treeIndex - second.treeIndex);
  const treeIndices = Uint32Array.from(byIndex, ({ treeIndex }) => treeIndex);
  const detailLevels = Uint8Array.from(byIndex, ({ detailLevel }) => detailLevel);
  const plannedPrimitiveCount = selectedCount * COARSE_PRIMITIVES
    + detailLevels.reduce((total, detailLevel) => (
      total
      + (detailLevel >= 1 ? BRANCH_PRIMITIVES : 0)
      + (detailLevel >= 2 ? FOLIAGE_PRIMITIVES : 0)
    ), 0);
  const detailTruncated = byIndex.some(({ detailLevel, wantedDetailLevel }) => (
    detailLevel < wantedDetailLevel
  ));

  return Object.freeze({
    kind: 'tree-view-demand:v1',
    treeIndices,
    detailLevels,
    primitiveBudget,
    plannedPrimitiveCount,
    vectorBytes: treeIndices.byteLength + detailLevels.byteLength,
    treeBudget,
    scannedTreeCount: forest.treeCount,
    visibleTreeCount: visible.length,
    culledTreeCount: forest.treeCount - visible.length,
    truncated: visible.length > selectedCount || detailTruncated,
  });
}
