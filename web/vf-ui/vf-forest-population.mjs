import {
  conditionChild,
  createConditionedRoot,
  sampleBoundedUniform,
  sampleWeightedCategoricalIndex,
} from './vf-conditioned-distribution.mjs';
import {
  sampleMarkedPointCell2Reference,
} from './vf-marked-point-candidates.mjs';

const forestState = new WeakMap();
const SPECIES_COUNT = 5;
const TREES_PER_PATCH = 32;
const MAX_DEMANDED_PATCHES = 2048;
const MAX_TREE_BUDGET = 65536;
const MAX_CACHED_PATCHES = MAX_DEMANDED_PATCHES * 2;
const PATCH_SIZE = 32;
const SPECIES_WEIGHTS = Object.freeze([34, 26, 18, 14, 8]);
const SPECIES_AFFINITY = Object.freeze([0.92, 0.88, 0.76, 0.71, 0.84]);
const DRY_FOLIAGE = Object.freeze([0.18, 0.28, 0.08]);
const LUSH_FOLIAGE = Object.freeze([0.08, 0.36, 0.12]);

function requirePatches(patches) {
  if (!Array.isArray(patches)) {
    throw new TypeError('forest demand patches must be an array');
  }
  if (patches.length > MAX_DEMANDED_PATCHES) {
    throw new RangeError(`forest demand exceeds ${MAX_DEMANDED_PATCHES} patches`);
  }
  const canonical = new Map();
  patches.forEach((patch, index) => {
    const typed = ArrayBuffer.isView(patch) && !(patch instanceof DataView);
    if ((!Array.isArray(patch) && !typed) || patch.length !== 2) {
      throw new TypeError(`forest demand patch[${index}] must contain two integers`);
    }
    for (let axis = 0; axis < 2; axis += 1) {
      if (!Number.isSafeInteger(patch[axis])) {
        throw new RangeError(`forest demand patch[${index}][${axis}] must be a safe integer`);
      }
      if (patch[axis] < -0x80000000 || patch[axis] > 0x7fffffff) {
        throw new RangeError(`forest demand patch[${index}][${axis}] must fit signed 32-bit`);
      }
    }
    canonical.set(`${patch[0]}:${patch[1]}`, [patch[0], patch[1]]);
  });
  return [...canonical.values()].sort((first, second) => (
    first[0] - second[0] || first[1] - second[1]
  ));
}

function requireTreeBudget(treeBudget) {
  if (!Number.isSafeInteger(treeBudget) || treeBudget < 0) {
    throw new RangeError('tree budget must be a non-negative safe integer');
  }
  if (treeBudget > MAX_TREE_BUDGET) {
    throw new RangeError(`tree budget exceeds ${MAX_TREE_BUDGET}`);
  }
}

function sampleUnit(node, lane) {
  return sampleBoundedUniform(node, [0, lane], { min: 0, max: 1 });
}

function realizeSpecies(state, speciesIndex) {
  const cached = state.speciesCache.get(speciesIndex);
  if (cached) return cached;
  const speciesNode = conditionChild(state.speciesNode, {
    segment: `tree:species:${speciesIndex}`,
    channel: 'species-traits',
  });
  const vigor = sampleUnit(speciesNode, 5);
  const species = Object.freeze({
    id: `tree:species:${speciesIndex}`,
    index: speciesIndex,
    patchAffinity: SPECIES_AFFINITY[speciesIndex],
    baseGrowth: Object.freeze([
      0.18 + sampleUnit(speciesNode, 0) * 0.5,
      9 + sampleUnit(speciesNode, 1) * 23,
      1.1 + sampleUnit(speciesNode, 2) * 3.8,
      3.5 + sampleUnit(speciesNode, 3) * 12,
    ]),
    foliageColor: Object.freeze([
      DRY_FOLIAGE[0] + (LUSH_FOLIAGE[0] - DRY_FOLIAGE[0]) * vigor,
      DRY_FOLIAGE[1] + (LUSH_FOLIAGE[1] - DRY_FOLIAGE[1]) * vigor,
      DRY_FOLIAGE[2] + (LUSH_FOLIAGE[2] - DRY_FOLIAGE[2]) * vigor,
      1,
    ]),
  });
  state.speciesCache.set(speciesIndex, species);
  return species;
}

function realizePatch(state, patchX, patchY) {
  const cacheKey = `${patchX}:${patchY}`;
  const cached = state.patchCache.get(cacheKey);
  if (cached) {
    state.patchCache.delete(cacheKey);
    state.patchCache.set(cacheKey, cached);
    return cached;
  }
  const patchNode = conditionChild(state.forestNode, {
    segment: `forest:patch:${patchX}:${patchY}`,
    channel: 'patch-species-mixture',
  });
  const dominantSpecies = sampleWeightedCategoricalIndex(
    patchNode,
    [0, 0],
    SPECIES_WEIGHTS,
  );
  const candidates = sampleMarkedPointCell2Reference(
    state.forestNode,
    [patchX, patchY],
    {
      cellSize: PATCH_SIZE,
      maxCandidates: TREES_PER_PATCH,
      baseProbability: 0.78,
      correlationLength: 160,
      spatialStrength: 0.4,
    },
  );
  const count = candidates.length;
  const ids = [];
  const positions = new Float32Array(count * 3);
  const growth = new Float32Array(count * 4);
  const rotations = new Float32Array(count);
  const speciesIndices = new Uint32Array(count);
  const dominant = realizeSpecies(state, dominantSpecies);
  candidates.forEach((candidate, index) => {
    const treeNode = conditionChild(patchNode, {
      segment: `tree:${candidate.id}`,
      channel: 'individual-growth',
    });
    const followsPatch = sampleUnit(treeNode, 0) < dominant.patchAffinity;
    const speciesIndex = followsPatch
      ? dominantSpecies
      : sampleWeightedCategoricalIndex(treeNode, [0, 1], SPECIES_WEIGHTS);
    const species = realizeSpecies(state, speciesIndex);
    const heightScale = 0.72 + sampleUnit(treeNode, 2) * 0.56;
    const breadthScale = 0.76 + sampleUnit(treeNode, 3) * 0.48;
    const trunkScale = 0.8 + sampleUnit(treeNode, 4) * 0.4;
    positions.set([candidate.position[0], candidate.position[1], 0], index * 3);
    growth.set([
      species.baseGrowth[0] * trunkScale * heightScale,
      species.baseGrowth[1] * heightScale,
      species.baseGrowth[2] * breadthScale,
      species.baseGrowth[3] * heightScale,
    ], index * 4);
    rotations[index] = candidate.marks.angle;
    speciesIndices[index] = speciesIndex;
    ids.push(`tree:v1:${candidate.id}`);
  });
  const patch = Object.freeze({
    id: `forest:patch:${patchX}:${patchY}`,
    cell: Object.freeze([patchX, patchY]),
    dominantSpecies,
    count,
    treeIds: Object.freeze(ids),
    positions,
    growth,
    rotations,
    speciesIndices,
  });
  state.patchCache.set(cacheKey, patch);
  if (state.patchCache.size > MAX_CACHED_PATCHES) {
    state.patchCache.delete(state.patchCache.keys().next().value);
  }
  return patch;
}

export function createForestPopulationReference(identity) {
  const root = createConditionedRoot(identity);
  const forest = Object.freeze({
    kind: 'forest-population:v1',
    identity: root,
    speciesCount: SPECIES_COUNT,
  });
  forestState.set(forest, {
    forestNode: conditionChild(root, {
      segment: 'forest:population:v1',
      channel: 'patch-population',
    }),
    speciesNode: conditionChild(root, {
      segment: 'forest:species:v1',
      channel: 'species-distribution',
    }),
    speciesCache: new Map(),
    patchCache: new Map(),
  });
  return forest;
}

export function realizeForestPatchesReference(
  forest,
  { patches, treeBudget },
) {
  const state = forestState.get(forest);
  if (!state) throw new TypeError('forest population is required');
  const demandedPatches = requirePatches(patches);
  requireTreeBudget(treeBudget);
  const realizedPatches = [];
  const slices = [];
  let treeCount = 0;
  for (const [patchX, patchY] of demandedPatches) {
    if (treeCount >= treeBudget) break;
    const patch = realizePatch(state, patchX, patchY);
    realizedPatches.push(patch);
    const count = Math.min(patch.count, treeBudget - treeCount);
    if (count > 0) slices.push({ patch, count });
    treeCount += count;
  }
  const treeIds = [];
  const positions = new Float32Array(treeCount * 3);
  const growth = new Float32Array(treeCount * 4);
  const rotations = new Float32Array(treeCount);
  const speciesIndices = new Uint32Array(treeCount);
  const usedSpeciesIndices = new Set();
  let offset = 0;
  for (const { patch, count } of slices) {
    treeIds.push(...patch.treeIds.slice(0, count));
    positions.set(patch.positions.subarray(0, count * 3), offset * 3);
    growth.set(patch.growth.subarray(0, count * 4), offset * 4);
    rotations.set(patch.rotations.subarray(0, count), offset);
    speciesIndices.set(patch.speciesIndices.subarray(0, count), offset);
    for (let index = 0; index < count; index += 1) {
      usedSpeciesIndices.add(patch.speciesIndices[index]);
    }
    offset += count;
  }
  const species = [...usedSpeciesIndices]
    .sort((first, second) => first - second)
    .map((speciesIndex) => realizeSpecies(state, speciesIndex));
  return Object.freeze({
    kind: 'forest-patch-working-set:v1',
    patches: Object.freeze(realizedPatches),
    demandedPatchCount: demandedPatches.length,
    treeCount,
    treeIds: Object.freeze(treeIds),
    positions,
    growth,
    rotations,
    speciesIndices,
    species: Object.freeze(species),
    vectorBytes: positions.byteLength + growth.byteLength
      + rotations.byteLength + speciesIndices.byteLength,
    budget: treeBudget,
  });
}
