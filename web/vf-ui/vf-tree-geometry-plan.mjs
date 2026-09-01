import {
  conditionChild,
  createConditionedRoot,
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';

const plannerState = new WeakMap();
const floatBitsBuffer = new ArrayBuffer(8);
const floatBitsView = new DataView(floatBitsBuffer);
const MAX_DEMANDED_TREES = 4096;
const MAX_PRIMITIVE_BUDGET = 65536;
const MAX_CACHED_TREES = MAX_DEMANDED_TREES * 2;
const BRANCHES_PER_TREE = 4;
const FOLIAGE_CLUSTERS_PER_BRANCH = 4;
const KIND_TRUNK = 0;
const KIND_CROWN = 1;
const KIND_BRANCH = 2;
const KIND_FOLIAGE = 3;

function float64Key(value) {
  floatBitsView.setFloat64(0, value, true);
  return `${floatBitsView.getUint32(4, true).toString(16)}:${floatBitsView.getUint32(0, true).toString(16)}`;
}

function requireForestWorkingSet(forest) {
  if (
    !forest
    || forest.kind !== 'forest-patch-working-set:v1'
    || !Array.isArray(forest.treeIds)
    || !(forest.positions instanceof Float32Array)
    || !(forest.growth instanceof Float32Array)
    || !(forest.speciesIndices instanceof Uint32Array)
    || forest.positions.length !== forest.treeIds.length * 3
    || forest.growth.length !== forest.treeIds.length * 4
    || forest.speciesIndices.length !== forest.treeIds.length
  ) {
    throw new TypeError('forest patch working set is required');
  }
}

function requireDemand(forest, treeIndices, detailLevels, primitiveBudget) {
  const indicesTyped = ArrayBuffer.isView(treeIndices) && !(treeIndices instanceof DataView);
  const levelsTyped = ArrayBuffer.isView(detailLevels) && !(detailLevels instanceof DataView);
  if ((!Array.isArray(treeIndices) && !indicesTyped) || treeIndices.length > MAX_DEMANDED_TREES) {
    throw new RangeError(`tree geometry demand must contain at most ${MAX_DEMANDED_TREES} indices`);
  }
  if ((!Array.isArray(detailLevels) && !levelsTyped) || detailLevels.length !== treeIndices.length) {
    throw new TypeError('tree geometry detail levels must parallel tree indices');
  }
  const canonical = new Map();
  for (let demandIndex = 0; demandIndex < treeIndices.length; demandIndex += 1) {
    const treeIndex = treeIndices[demandIndex];
    const detailLevel = detailLevels[demandIndex];
    if (!Number.isSafeInteger(treeIndex) || treeIndex < 0 || treeIndex >= forest.treeCount) {
      throw new RangeError(`tree geometry index[${demandIndex}] is outside the forest working set`);
    }
    if (!Number.isSafeInteger(detailLevel) || detailLevel < 0 || detailLevel > 2) {
      throw new RangeError(`tree geometry detailLevel[${demandIndex}] must be in [0, 2]`);
    }
    canonical.set(treeIndex, Math.max(detailLevel, canonical.get(treeIndex) ?? 0));
  }
  if (!Number.isSafeInteger(primitiveBudget) || primitiveBudget < 0) {
    throw new RangeError('tree primitive budget must be a non-negative safe integer');
  }
  if (primitiveBudget > MAX_PRIMITIVE_BUDGET) {
    throw new RangeError(`tree primitive budget exceeds ${MAX_PRIMITIVE_BUDGET}`);
  }
  return [...canonical]
    .sort(([first], [second]) => first - second)
    .map(([treeIndex, detailLevel]) => ({ treeIndex, detailLevel }));
}

function sample(node, sampleIndex, lane, minimum, maximum) {
  return sampleBoundedUniform(node, [sampleIndex, lane], {
    min: minimum,
    max: maximum,
  });
}

function primitive(id, kind, level, parentId, transform) {
  return Object.freeze({
    id,
    kind,
    level,
    parentId,
    transform: Object.freeze(transform),
  });
}

function treeCacheKey(forest, treeIndex) {
  const growthOffset = treeIndex * 4;
  return [
    forest.treeIds[treeIndex],
    ...Array.from(forest.positions.subarray(treeIndex * 3, treeIndex * 3 + 3), float64Key),
    ...Array.from(forest.growth.subarray(growthOffset, growthOffset + 4), float64Key),
    forest.speciesIndices[treeIndex],
  ].join('/');
}

function treeRealization(state, forest, treeIndex) {
  const cacheKey = treeCacheKey(forest, treeIndex);
  const cached = state.treeCache.get(cacheKey);
  if (cached) {
    state.treeCache.delete(cacheKey);
    state.treeCache.set(cacheKey, cached);
    return cached;
  }
  const treeId = forest.treeIds[treeIndex];
  const tree = {
    id: treeId,
    treeIndex,
    node: conditionChild(state.geometryNode, {
      segment: `geometry:${treeId}`,
      channel: 'tree-geometry',
    }),
    position: Array.from(forest.positions.subarray(treeIndex * 3, treeIndex * 3 + 3)),
    growth: Array.from(forest.growth.subarray(treeIndex * 4, treeIndex * 4 + 4)),
    levels: new Map(),
  };
  state.treeCache.set(cacheKey, tree);
  if (state.treeCache.size > MAX_CACHED_TREES) {
    state.treeCache.delete(state.treeCache.keys().next().value);
  }
  return tree;
}

function realizeCoarse(tree) {
  const [x, y, z] = tree.position;
  const [trunkRadius, height, crownRadius, crownHeight] = tree.growth;
  return Object.freeze([
    primitive(
      `${tree.id}:trunk`,
      KIND_TRUNK,
      0,
      null,
      [x, y, z + height * 0.5, 0, 0, 1, height, trunkRadius],
    ),
    primitive(
      `${tree.id}:crown`,
      KIND_CROWN,
      0,
      null,
      [x, y, z + height - crownHeight * 0.5, 0, 0, 1, crownHeight, crownRadius],
    ),
  ]);
}

function realizeBranches(tree) {
  const [x, y, z] = tree.position;
  const [trunkRadius, height, crownRadius, crownHeight] = tree.growth;
  const branches = [];
  for (let branchIndex = 0; branchIndex < BRANCHES_PER_TREE; branchIndex += 1) {
    const angle = 2 * Math.PI * (
      branchIndex / BRANCHES_PER_TREE
      + sample(tree.node, branchIndex, 0, -0.07, 0.07)
    );
    const elevation = sample(tree.node, branchIndex, 1, 0.22, 0.62);
    const length = crownRadius * sample(tree.node, branchIndex, 2, 0.72, 1.18);
    const originZ = z + height - crownHeight * sample(tree.node, branchIndex, 3, 0.28, 0.78);
    branches.push(primitive(
      `${tree.id}:branch:${branchIndex}`,
      KIND_BRANCH,
      1,
      `${tree.id}:trunk`,
      [
        x,
        y,
        originZ,
        Math.cos(angle) * Math.cos(elevation),
        Math.sin(angle) * Math.cos(elevation),
        Math.sin(elevation),
        length,
        trunkRadius * sample(tree.node, branchIndex, 4, 0.12, 0.24),
      ],
    ));
  }
  return Object.freeze(branches);
}

function realizeFoliage(tree, branches) {
  const [, , , crownHeight] = tree.growth;
  const foliage = [];
  branches.forEach((branch, branchIndex) => {
    const [x, y, z, dx, dy, dz, length] = branch.transform;
    for (
      let clusterIndex = 0;
      clusterIndex < FOLIAGE_CLUSTERS_PER_BRANCH;
      clusterIndex += 1
    ) {
      const sampleIndex = branchIndex * FOLIAGE_CLUSTERS_PER_BRANCH + clusterIndex;
      const along = sample(tree.node, sampleIndex, 5, 0.34, 1);
      const radius = crownHeight * sample(tree.node, sampleIndex, 6, 0.06, 0.14);
      foliage.push(primitive(
        `${tree.id}:branch:${branchIndex}:foliage:${clusterIndex}`,
        KIND_FOLIAGE,
        2,
        branch.id,
        [
          x + dx * length * along,
          y + dy * length * along,
          z + dz * length * along,
          dx,
          dy,
          dz,
          radius * 1.8,
          radius,
        ],
      ));
    }
  });
  return Object.freeze(foliage);
}

function realizeLevel(tree, level) {
  const cached = tree.levels.get(level);
  if (cached) return cached;
  let records;
  if (level === 0) records = realizeCoarse(tree);
  else if (level === 1) records = realizeBranches(tree);
  else records = realizeFoliage(tree, realizeLevel(tree, 1));
  tree.levels.set(level, records);
  return records;
}

export function createTreeGeometryPlannerReference(identity) {
  const root = createConditionedRoot(identity);
  const planner = Object.freeze({
    kind: 'tree-geometry-planner:v1',
    identity: root,
    maxDetailLevel: 2,
  });
  plannerState.set(planner, {
    geometryNode: conditionChild(root, {
      segment: 'forest:tree-geometry:v1',
      channel: 'geometry-plan',
    }),
    treeCache: new Map(),
  });
  return planner;
}

export function planTreeGeometryReference(
  planner,
  forest,
  { treeIndices, detailLevels, primitiveBudget },
) {
  const state = plannerState.get(planner);
  if (!state) throw new TypeError('tree geometry planner is required');
  requireForestWorkingSet(forest);
  const demands = requireDemand(forest, treeIndices, detailLevels, primitiveBudget);
  const selected = [];
  const selectedIds = new Map();
  const treePrimitives = new Map();
  for (let level = 0; level <= 2 && selected.length < primitiveBudget; level += 1) {
    for (const demand of demands) {
      if (demand.detailLevel < level || selected.length >= primitiveBudget) continue;
      const tree = treeRealization(state, forest, demand.treeIndex);
      for (const record of realizeLevel(tree, level)) {
        if (selected.length >= primitiveBudget) break;
        if (record.parentId != null && !selectedIds.has(record.parentId)) continue;
        selectedIds.set(record.id, selected.length);
        selected.push({ record, treeIndex: demand.treeIndex });
        if (!treePrimitives.has(demand.treeIndex)) treePrimitives.set(demand.treeIndex, []);
        treePrimitives.get(demand.treeIndex).push(record);
      }
    }
  }
  const primitiveCount = selected.length;
  const primitiveIds = [];
  const kinds = new Uint8Array(primitiveCount);
  const levels = new Uint8Array(primitiveCount);
  const owners = new Uint32Array(primitiveCount);
  const parents = new Int32Array(primitiveCount);
  const transforms = new Float32Array(primitiveCount * 8);
  selected.forEach(({ record, treeIndex }, index) => {
    primitiveIds.push(record.id);
    kinds[index] = record.kind;
    levels[index] = record.level;
    owners[index] = treeIndex;
    parents[index] = record.parentId == null ? -1 : selectedIds.get(record.parentId);
    transforms.set(record.transform, index * 8);
  });
  const trees = demands
    .filter(({ treeIndex }) => treePrimitives.has(treeIndex))
    .map(({ treeIndex, detailLevel }) => Object.freeze({
      id: forest.treeIds[treeIndex],
      treeIndex,
      detailLevel,
      primitives: Object.freeze(treePrimitives.get(treeIndex)),
    }));
  return Object.freeze({
    kind: 'tree-geometry-plan:v1',
    trees: Object.freeze(trees),
    demandedTreeCount: demands.length,
    primitiveCount,
    primitiveIds: Object.freeze(primitiveIds),
    kinds,
    levels,
    owners,
    parents,
    transforms,
    vectorBytes: kinds.byteLength + levels.byteLength + owners.byteLength
      + parents.byteLength + transforms.byteLength,
    budget: primitiveBudget,
  });
}
