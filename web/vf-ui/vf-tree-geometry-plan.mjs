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
const PRIMARY_BRANCHES = 6;
const CHILDREN_PER_BRANCH = 2;
const TERMINAL_TWIGS_PER_BRANCH = 2;
const PRIMARY_TWIG_SLOTS = 1;
const SECONDARY_TWIG_SLOTS = 2;
const KIND_TRUNK = 0;
const KIND_CROWN = 1;
const KIND_BRANCH = 2;
const KIND_FOLIAGE = 3;
const KIND_TWIG = 4;

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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  if (!(length > 1.0e-12)) throw new RangeError('tree branch direction must be non-zero');
  return vector.map((value) => value / length);
}

function branchNode(tree, path) {
  return conditionChild(tree.node, {
    segment: `branch:${path.join('.')}`,
    channel: 'branch-geometry',
  });
}

function directionFromAngles(azimuth, elevation) {
  const horizontal = Math.cos(elevation);
  return [
    Math.cos(azimuth) * horizontal,
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
  ];
}

function primaryDirection(node) {
  return directionFromAngles(
    sample(node, 0, 0, 0, Math.PI * 2),
    sample(node, 0, 1, 0.24, 0.72),
  );
}

function childDirection(node, parentDirection, generation) {
  const parentAzimuth = Math.atan2(parentDirection[1], parentDirection[0]);
  const parentElevation = Math.asin(clamp(parentDirection[2], -1, 1));
  const azimuthSpread = generation === 1 ? 1.18 : 0.92;
  const upwardBias = generation === 1 ? 0.08 : 0.12;
  const maximumElevation = generation === 1 ? 1.02 : 1.18;
  return normalize(directionFromAngles(
    parentAzimuth + sample(node, 0, 0, -azimuthSpread, azimuthSpread),
    clamp(
      parentElevation + sample(node, 0, 1, -0.24, 0.24) + upwardBias,
      0.14,
      maximumElevation,
    ),
  ));
}

function pointAlong(transform, along, centered = false) {
  const start = centered
    ? transform.slice(0, 3).map((value, axis) => (
      value - transform[axis + 3] * transform[6] * 0.5
    ))
    : transform.slice(0, 3);
  return start.map((value, axis) => value + transform[axis + 3] * transform[6] * along);
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
  const [trunkRadius, height, crownRadius] = tree.growth;
  const trunk = realizeLevel(tree, 0)[0];
  const branches = [];
  for (let branchIndex = 0; branchIndex < PRIMARY_BRANCHES; branchIndex += 1) {
    const node = branchNode(tree, [0, branchIndex]);
    const direction = primaryDirection(node);
    const origin = pointAlong(trunk.transform, sample(node, 0, 2, 0.32, 0.88), true);
    branches.push(primitive(
      `${tree.id}:branch:g0:${branchIndex}`,
      KIND_BRANCH,
      1,
      trunk.id,
      [
        ...origin,
        ...direction,
        crownRadius * sample(node, 0, 3, 0.72, 1.16),
        trunkRadius * sample(node, 0, 4, 0.34, 0.52),
      ],
    ));
  }
  return Object.freeze(branches);
}

function childBranch(tree, parent, path, generation, childIndex) {
  const node = branchNode(tree, path);
  const direction = childDirection(node, parent.transform.slice(3, 6), generation);
  const along = generation === 1
    ? sample(node, 0, 2, 0.35, 0.82)
    : sample(node, 0, 2, 0.42, 0.9);
  return primitive(
    `${parent.id}:g${generation}:${childIndex}`,
    KIND_BRANCH,
    2,
    parent.id,
    [
      ...pointAlong(parent.transform, along),
      ...direction,
      parent.transform[6] * sample(node, 0, 3, generation === 1 ? 0.52 : 0.48, generation === 1 ? 0.72 : 0.68),
      parent.transform[7] * sample(node, 0, 4, generation === 1 ? 0.52 : 0.48, generation === 1 ? 0.68 : 0.64),
    ],
  );
}

function twigProbability(tree, parent) {
  const relativeRadius = parent.transform[7] / tree.growth[0];
  return clamp((0.5 - relativeRadius) / 0.45, 0, 0.82);
}

function twigShoot(tree, parent, path, twigIndex, terminal) {
  const node = branchNode(tree, path);
  return primitive(
    `${parent.id}:twig:${twigIndex}`,
    KIND_TWIG,
    2,
    parent.id,
    [
      ...pointAlong(parent.transform, sample(node, 0, 2, terminal ? 0.55 : 0.28, 0.94)),
      ...childDirection(node, parent.transform.slice(3, 6), 2),
      parent.transform[6] * sample(node, 0, 3, terminal ? 0.42 : 0.32, terminal ? 0.62 : 0.54),
      parent.transform[7] * sample(node, 0, 4, 0.28, 0.48),
    ],
  );
}

function optionalTwigs(tree, parent, path, slotCount, indexOffset = 0) {
  const twigs = [];
  const probability = twigProbability(tree, parent);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const node = branchNode(tree, [...path, slot]);
    if (sample(node, 0, 7, 0, 1) < probability) {
      twigs.push(twigShoot(tree, parent, [...path, slot], indexOffset + slot, false));
    }
  }
  return twigs;
}

function realizeFine(tree, primaries) {
  const [, , , crownHeight] = tree.growth;
  const secondaries = [];
  const twigs = [];
  const foliage = [];
  primaries.forEach((primary, primaryIndex) => {
    for (let childIndex = 0; childIndex < CHILDREN_PER_BRANCH; childIndex += 1) {
      secondaries.push(childBranch(
        tree,
        primary,
        [1, primaryIndex, childIndex],
        1,
        childIndex,
      ));
    }
  });
  secondaries.forEach((secondary, secondaryIndex) => {
    for (let twigIndex = 0; twigIndex < TERMINAL_TWIGS_PER_BRANCH; twigIndex += 1) {
      twigs.push(twigShoot(tree, secondary, [2, secondaryIndex, twigIndex], twigIndex, true));
    }
    twigs.push(...optionalTwigs(
      tree,
      secondary,
      [3, secondaryIndex],
      SECONDARY_TWIG_SLOTS,
      TERMINAL_TWIGS_PER_BRANCH,
    ));
  });
  primaries.forEach((primary, primaryIndex) => {
    twigs.push(...optionalTwigs(
      tree,
      primary,
      [4, primaryIndex],
      PRIMARY_TWIG_SLOTS,
    ));
  });
  twigs.forEach((twig, twigIndex) => {
    const node = branchNode(tree, [5, twigIndex]);
    const radius = crownHeight * sample(node, 0, 5, 0.045, 0.085);
    foliage.push(primitive(
        `${twig.id}:foliage`,
        KIND_FOLIAGE,
        2,
        twig.id,
        [
          ...pointAlong(twig.transform, sample(node, 0, 6, 0.82, 1)),
          ...twig.transform.slice(3, 6),
          radius * 1.8,
          radius,
        ],
      ));
  });
  return Object.freeze([...secondaries, ...twigs, ...foliage]);
}

function realizeLevel(tree, level) {
  const cached = tree.levels.get(level);
  if (cached) return cached;
  let records;
  if (level === 0) records = realizeCoarse(tree);
  else if (level === 1) records = realizeBranches(tree);
  else records = realizeFine(tree, realizeLevel(tree, 1));
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
