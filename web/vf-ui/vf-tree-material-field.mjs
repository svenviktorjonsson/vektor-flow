import {
  conditionChild,
  createConditionedRoot,
  sampleBoundedUniform,
} from './vf-conditioned-distribution.mjs';

const fieldState = new WeakMap();
const MAX_MATERIAL_BUDGET = 65536;
const MAX_CACHED_MATERIAL_TREES = 4096;
const MATERIAL_BARK = 0;
const MATERIAL_FOLIAGE = 1;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function requireBudget(materialBudget) {
  if (
    !Number.isSafeInteger(materialBudget)
    || materialBudget < 0
    || materialBudget > MAX_MATERIAL_BUDGET
  ) {
    throw new RangeError(`materialBudget must be an integer from 0 to ${MAX_MATERIAL_BUDGET}`);
  }
}

function requireForest(forest) {
  if (
    !forest
    || forest.kind !== 'forest-patch-working-set:v1'
    || !Number.isSafeInteger(forest.treeCount)
    || !Array.isArray(forest.treeIds)
    || !(forest.speciesIndices instanceof Uint32Array)
    || forest.treeIds.length !== forest.treeCount
    || forest.speciesIndices.length !== forest.treeCount
    || !Array.isArray(forest.species)
  ) {
    throw new TypeError('forest patch working set is required');
  }
}

function requireGeometryPlan(forest, plan) {
  if (
    !plan
    || plan.kind !== 'tree-geometry-plan:v1'
    || !Number.isSafeInteger(plan.primitiveCount)
    || !Array.isArray(plan.primitiveIds)
    || !(plan.kinds instanceof Uint8Array)
    || !(plan.owners instanceof Uint32Array)
    || plan.primitiveIds.length !== plan.primitiveCount
    || plan.kinds.length !== plan.primitiveCount
    || plan.owners.length !== plan.primitiveCount
  ) {
    throw new TypeError('tree geometry plan is required');
  }
  for (let index = 0; index < plan.primitiveCount; index += 1) {
    if (plan.owners[index] >= forest.treeCount) {
      throw new RangeError(`tree material owner[${index}] is outside the forest working set`);
    }
    if (plan.kinds[index] > 3) {
      throw new RangeError(`tree material kind[${index}] is unsupported`);
    }
  }
}

function sampleUnit(node, lane) {
  return sampleBoundedUniform(node, [0, lane], { min: 0, max: 1 });
}

function speciesByIndex(forest, speciesIndex) {
  const species = forest.species.find(({ index }) => index === speciesIndex);
  if (!species || !Array.isArray(species.foliageColor) || species.foliageColor.length !== 4) {
    throw new TypeError(`forest species ${speciesIndex} is unavailable`);
  }
  return species;
}

function speciesMaterial(state, forest, speciesIndex) {
  const cached = state.speciesCache.get(speciesIndex);
  if (cached) return cached;
  const species = speciesByIndex(forest, speciesIndex);
  const node = conditionChild(state.materialNode, {
    segment: `tree:species:${speciesIndex}`,
    channel: 'species-material',
  });
  const record = Object.freeze({
    barkColor: Object.freeze([
      0.14 + sampleUnit(node, 0) * 0.15,
      0.055 + sampleUnit(node, 1) * 0.11,
      0.022 + sampleUnit(node, 2) * 0.055,
    ]),
    foliageColor: Object.freeze(species.foliageColor.slice(0, 3)),
    barkRoughness: 0.72 + sampleUnit(node, 3) * 0.23,
    foliageRoughness: 0.46 + sampleUnit(node, 4) * 0.27,
    barkPatternScale: 3 + sampleUnit(node, 5) * 6,
    foliagePatternScale: 0.75 + sampleUnit(node, 6) * 1.75,
  });
  state.speciesCache.set(speciesIndex, record);
  return record;
}

function treeMaterialState(state, forest, treeIndex) {
  const treeId = forest.treeIds[treeIndex];
  const speciesIndex = forest.speciesIndices[treeIndex];
  const cacheKey = `${treeId}/species:${speciesIndex}`;
  const cached = state.treeCache.get(cacheKey);
  if (cached) {
    state.treeCache.delete(cacheKey);
    state.treeCache.set(cacheKey, cached);
    return cached;
  }
  const node = conditionChild(state.materialNode, {
    segment: treeId,
    channel: 'individual-material',
  });
  const tree = {
    id: treeId,
    species: speciesMaterial(state, forest, speciesIndex),
    node,
    colorVariation: (sampleUnit(node, 0) - 0.5) * 0.12,
    roughnessVariation: (sampleUnit(node, 1) - 0.5) * 0.1,
    materials: new Map(),
  };
  state.treeCache.set(cacheKey, tree);
  if (state.treeCache.size > MAX_CACHED_MATERIAL_TREES) {
    state.treeCache.delete(state.treeCache.keys().next().value);
  }
  return tree;
}

function realizePrimitiveMaterial(tree, primitiveId, geometryKind) {
  const cached = tree.materials.get(primitiveId);
  if (cached) return cached;
  const node = conditionChild(tree.node, {
    segment: primitiveId,
    channel: 'surface-material',
  });
  const materialKind = geometryKind === 0 || geometryKind === 2
    ? MATERIAL_BARK
    : MATERIAL_FOLIAGE;
  const speciesColor = materialKind === MATERIAL_BARK
    ? tree.species.barkColor
    : tree.species.foliageColor;
  const primitiveVariation = (sampleUnit(node, 0) - 0.5) * 0.05;
  const colorVariation = tree.colorVariation + primitiveVariation;
  const baseColor = Object.freeze([
    clamp01(speciesColor[0] + colorVariation),
    clamp01(speciesColor[1] + colorVariation),
    clamp01(speciesColor[2] + colorVariation),
    1,
  ]);
  const roughnessBase = materialKind === MATERIAL_BARK
    ? tree.species.barkRoughness
    : tree.species.foliageRoughness;
  const surfaceParams = materialKind === MATERIAL_BARK
    ? Object.freeze([
      clamp01(roughnessBase + tree.roughnessVariation),
      0.35 + sampleUnit(node, 1) * 0.45,
      0,
      tree.species.barkPatternScale * (0.9 + sampleUnit(node, 2) * 0.2),
    ])
    : Object.freeze([
      clamp01(roughnessBase + tree.roughnessVariation),
      0.12 + sampleUnit(node, 1) * 0.28,
      0.08 + sampleUnit(node, 2) * 0.16,
      tree.species.foliagePatternScale * (0.9 + sampleUnit(node, 3) * 0.2),
    ]);
  const material = Object.freeze({
    id: `${primitiveId}:material`,
    primitiveId,
    materialKind,
    baseColor,
    surfaceParams,
  });
  tree.materials.set(primitiveId, material);
  return material;
}

export function createTreeMaterialFieldReference(identity) {
  const root = createConditionedRoot(identity);
  const field = Object.freeze({
    kind: 'tree-material-field:v1',
    identity: root,
  });
  fieldState.set(field, {
    materialNode: conditionChild(root, {
      segment: 'forest:tree-material:v1',
      channel: 'material-realization',
    }),
    speciesCache: new Map(),
    treeCache: new Map(),
  });
  return field;
}

export function realizeTreeMaterialsReference(
  field,
  forest,
  plan,
  { materialBudget },
) {
  const state = fieldState.get(field);
  if (!state) throw new TypeError('tree material field is required');
  requireForest(forest);
  requireGeometryPlan(forest, plan);
  requireBudget(materialBudget);
  const materialCount = Math.min(plan.primitiveCount, materialBudget);
  const primitiveIds = [];
  const materials = [];
  const materialKinds = new Uint8Array(materialCount);
  const baseColors = new Float32Array(materialCount * 4);
  const surfaceParams = new Float32Array(materialCount * 4);
  for (let index = 0; index < materialCount; index += 1) {
    const tree = treeMaterialState(state, forest, plan.owners[index]);
    const material = realizePrimitiveMaterial(tree, plan.primitiveIds[index], plan.kinds[index]);
    primitiveIds.push(plan.primitiveIds[index]);
    materials.push(material);
    materialKinds[index] = material.materialKind;
    baseColors.set(material.baseColor, index * 4);
    surfaceParams.set(material.surfaceParams, index * 4);
  }
  return Object.freeze({
    kind: 'tree-material-working-set:v1',
    primitiveIds: Object.freeze(primitiveIds),
    materials: Object.freeze(materials),
    materialCount,
    materialKinds,
    baseColors,
    surfaceParams,
    vectorBytes: materialKinds.byteLength + baseColors.byteLength + surfaceParams.byteLength,
    budget: materialBudget,
    truncated: materialCount < plan.primitiveCount,
  });
}
