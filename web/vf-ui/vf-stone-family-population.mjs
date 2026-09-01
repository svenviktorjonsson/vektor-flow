import {
  conditionChild,
  createConditionedRoot,
  sampleBoundedUniform,
  sampleWeightedCategoricalIndex,
} from './vf-conditioned-distribution.mjs';
import {
  sampleMarkedPointCell2Reference,
} from './vf-marked-point-candidates.mjs';
import {
  createRockMaterialFieldReference,
} from './vf-rock-material-field.mjs';

const populationState = new WeakMap();
const FAMILY_COUNT = 4;
const STONE_SLOTS_PER_PATCH = 16;
const MAX_DEMANDED_PATCHES = 4096;
const MAX_STONE_BUDGET = 65536;
const MAX_CACHED_PATCHES = MAX_DEMANDED_PATCHES * 2;
const PATCH_SIZE = 4;
const FAMILY_WEIGHTS = Object.freeze([1, 1, 1, 1]);

function requirePatches(patches) {
  if (!Array.isArray(patches)) {
    throw new TypeError('stone demand patches must be an array');
  }
  if (patches.length > MAX_DEMANDED_PATCHES) {
    throw new RangeError(`stone demand exceeds ${MAX_DEMANDED_PATCHES} patches`);
  }
  const canonical = new Map();
  patches.forEach((patch, index) => {
    const typed = ArrayBuffer.isView(patch) && !(patch instanceof DataView);
    if ((!Array.isArray(patch) && !typed) || patch.length !== 2) {
      throw new TypeError(`stone demand patch[${index}] must contain two integers`);
    }
    for (let axis = 0; axis < 2; axis += 1) {
      if (!Number.isSafeInteger(patch[axis])) {
        throw new RangeError(`stone demand patch[${index}][${axis}] must be a safe integer`);
      }
      if (patch[axis] < -0x80000000 || patch[axis] > 0x7fffffff) {
        throw new RangeError(`stone demand patch[${index}][${axis}] must fit signed 32-bit`);
      }
    }
    canonical.set(`${patch[0]}:${patch[1]}`, [patch[0], patch[1]]);
  });
  return [...canonical.values()].sort((first, second) => (
    first[0] - second[0] || first[1] - second[1]
  ));
}

function requireStoneBudget(stoneBudget) {
  if (!Number.isSafeInteger(stoneBudget) || stoneBudget < 0) {
    throw new RangeError('stone budget must be a non-negative safe integer');
  }
  if (stoneBudget > MAX_STONE_BUDGET) {
    throw new RangeError(`stone budget exceeds ${MAX_STONE_BUDGET}`);
  }
}

function sampleUnit(node, lane) {
  return sampleBoundedUniform(node, [0, lane], { min: 0, max: 1 });
}

function realizeFamily(state, familyIndex) {
  const cached = state.familyCache.get(familyIndex);
  if (cached) return cached;
  const familyNode = conditionChild(state.familyNode, {
    segment: `stone:family:${familyIndex}`,
    channel: 'family-traits',
  });
  const family = Object.freeze({
    id: `stone:family:${familyIndex}`,
    index: familyIndex,
    baseRadii: Object.freeze([
      0.34 + sampleUnit(familyNode, 0) * 0.62,
      0.28 + sampleUnit(familyNode, 1) * 0.48,
      0.22 + sampleUnit(familyNode, 2) * 0.42,
    ]),
    materialField: createRockMaterialFieldReference(familyNode),
  });
  state.familyCache.set(familyIndex, family);
  return family;
}

function realizePatch(state, patchX, patchY) {
  const cacheKey = `${patchX}:${patchY}`;
  const cached = state.patchCache.get(cacheKey);
  if (cached) {
    state.patchCache.delete(cacheKey);
    state.patchCache.set(cacheKey, cached);
    return cached;
  }
  const patchNode = conditionChild(state.populationNode, {
    segment: `stone:patch:${patchX}:${patchY}`,
    channel: 'patch-family-mixture',
  });
  const dominantFamily = sampleWeightedCategoricalIndex(
    patchNode,
    [0, 0],
    FAMILY_WEIGHTS,
  );
  const candidates = sampleMarkedPointCell2Reference(
    state.populationNode,
    [patchX, patchY],
    {
      cellSize: PATCH_SIZE,
      maxCandidates: STONE_SLOTS_PER_PATCH,
      baseProbability: 0.8,
      correlationLength: 24,
      spatialStrength: 0.25,
    },
  );
  const count = candidates.length;
  const ids = [];
  const positions = new Float32Array(count * 3);
  const radii = new Float32Array(count * 3);
  const rotations = new Float32Array(count);
  const familyIndices = new Uint32Array(count);
  candidates.forEach((candidate, index) => {
    const stoneNode = conditionChild(patchNode, {
      segment: `stone:${candidate.id}`,
      channel: 'individual-traits',
    });
    const followsPatch = sampleUnit(stoneNode, 0) < 0.82;
    const familyIndex = followsPatch
      ? dominantFamily
      : sampleWeightedCategoricalIndex(stoneNode, [0, 1], FAMILY_WEIGHTS);
    const family = realizeFamily(state, familyIndex);
    const scale = 0.68 + sampleUnit(stoneNode, 2) * 0.64;
    const asymmetry = 0.84 + sampleUnit(stoneNode, 3) * 0.32;
    const radiiOffset = index * 3;
    radii[radiiOffset] = family.baseRadii[0] * scale * asymmetry;
    radii[radiiOffset + 1] = family.baseRadii[1] * scale / asymmetry;
    radii[radiiOffset + 2] = family.baseRadii[2] * scale;
    positions.set([
      candidate.position[0],
      candidate.position[1],
      radii[radiiOffset + 2],
    ], radiiOffset);
    rotations[index] = candidate.marks.angle;
    familyIndices[index] = familyIndex;
    ids.push(`stone:v1:${candidate.id}`);
  });
  const patch = Object.freeze({
    id: `stone:patch:${patchX}:${patchY}`,
    cell: Object.freeze([patchX, patchY]),
    dominantFamily,
    count,
    stoneIds: Object.freeze(ids),
    positions,
    radii,
    rotations,
    familyIndices,
  });
  state.patchCache.set(cacheKey, patch);
  if (state.patchCache.size > MAX_CACHED_PATCHES) {
    state.patchCache.delete(state.patchCache.keys().next().value);
  }
  return patch;
}

export function createStoneFamilyPopulationReference(identity) {
  const root = createConditionedRoot(identity);
  const population = Object.freeze({
    kind: 'stone-family-population:v1',
    identity: root,
    familyCount: FAMILY_COUNT,
  });
  populationState.set(population, {
    populationNode: conditionChild(root, {
      segment: 'stone:population:v1',
      channel: 'patch-population',
    }),
    familyNode: conditionChild(root, {
      segment: 'stone:families:v1',
      channel: 'family-distribution',
    }),
    familyCache: new Map(),
    patchCache: new Map(),
  });
  return population;
}

export function realizeStoneFamilyPatchesReference(
  population,
  { patches, stoneBudget },
) {
  const state = populationState.get(population);
  if (!state) throw new TypeError('stone family population is required');
  const demandedPatches = requirePatches(patches);
  requireStoneBudget(stoneBudget);
  const realizedPatches = [];
  const slices = [];
  let stoneCount = 0;
  for (const [patchX, patchY] of demandedPatches) {
    if (stoneCount >= stoneBudget) break;
    const patch = realizePatch(state, patchX, patchY);
    realizedPatches.push(patch);
    const count = Math.min(patch.count, stoneBudget - stoneCount);
    if (count > 0) slices.push({ patch, count });
    stoneCount += count;
  }
  const stoneIds = [];
  const positions = new Float32Array(stoneCount * 3);
  const radii = new Float32Array(stoneCount * 3);
  const rotations = new Float32Array(stoneCount);
  const familyIndices = new Uint32Array(stoneCount);
  const usedFamilyIndices = new Set();
  let offset = 0;
  for (const { patch, count } of slices) {
    stoneIds.push(...patch.stoneIds.slice(0, count));
    positions.set(patch.positions.subarray(0, count * 3), offset * 3);
    radii.set(patch.radii.subarray(0, count * 3), offset * 3);
    rotations.set(patch.rotations.subarray(0, count), offset);
    familyIndices.set(patch.familyIndices.subarray(0, count), offset);
    for (let index = 0; index < count; index += 1) {
      usedFamilyIndices.add(patch.familyIndices[index]);
    }
    offset += count;
  }
  const families = [...usedFamilyIndices]
    .sort((first, second) => first - second)
    .map((familyIndex) => realizeFamily(state, familyIndex));
  return Object.freeze({
    kind: 'stone-family-patch-working-set:v1',
    patches: Object.freeze(realizedPatches),
    demandedPatchCount: demandedPatches.length,
    stoneCount,
    stoneIds: Object.freeze(stoneIds),
    positions,
    radii,
    rotations,
    familyIndices,
    families: Object.freeze(families),
    vectorBytes: positions.byteLength + radii.byteLength
      + rotations.byteLength + familyIndices.byteLength,
    budget: stoneBudget,
  });
}
