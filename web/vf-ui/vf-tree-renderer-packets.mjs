const adapterMetadata = new WeakMap();

function requireWorkingSets(geometry, materials) {
  if (
    !geometry
    || geometry.kind !== 'tree-geometry-plan:v1'
    || !Array.isArray(geometry.trees)
    || !Array.isArray(geometry.primitiveIds)
    || !(geometry.kinds instanceof Uint8Array)
    || !(geometry.levels instanceof Uint8Array)
    || !(geometry.owners instanceof Uint32Array)
    || !(geometry.parents instanceof Int32Array)
    || !(geometry.transforms instanceof Float32Array)
    || geometry.primitiveIds.length !== geometry.primitiveCount
    || geometry.kinds.length !== geometry.primitiveCount
    || geometry.levels.length !== geometry.primitiveCount
    || geometry.owners.length !== geometry.primitiveCount
    || geometry.parents.length !== geometry.primitiveCount
    || geometry.transforms.length !== geometry.primitiveCount * 8
  ) {
    throw new TypeError('tree geometry plan is required');
  }
  if (
    !materials
    || materials.kind !== 'tree-material-working-set:v1'
    || !Array.isArray(materials.primitiveIds)
    || !Array.isArray(materials.materials)
    || !(materials.materialKinds instanceof Uint8Array)
    || !(materials.baseColors instanceof Float32Array)
    || !(materials.surfaceParams instanceof Float32Array)
    || materials.materialCount !== geometry.primitiveCount
    || materials.primitiveIds.length !== geometry.primitiveCount
    || materials.materials.length !== geometry.primitiveCount
    || materials.materialKinds.length !== geometry.primitiveCount
    || materials.baseColors.length !== geometry.primitiveCount * 4
    || materials.surfaceParams.length !== geometry.primitiveCount * 4
  ) {
    throw new TypeError('aligned tree material working set is required');
  }
  for (let index = 0; index < geometry.primitiveCount; index += 1) {
    if (geometry.primitiveIds[index] !== materials.primitiveIds[index]) {
      throw new RangeError('tree geometry and material primitive identities must align');
    }
  }
}

function collectTreeSources(geometry, materials) {
  const treeByIndex = new Map(geometry.trees.map((tree) => [tree.treeIndex, tree]));
  const recordById = new Map(geometry.trees.flatMap((tree) => (
    tree.primitives.map((primitive) => [primitive.id, primitive])
  )));
  const sources = new Map();
  for (let index = 0; index < geometry.primitiveCount; index += 1) {
    const treeIndex = geometry.owners[index];
    const tree = treeByIndex.get(treeIndex);
    const primitive = recordById.get(geometry.primitiveIds[index]);
    if (!tree || !primitive) {
      throw new RangeError('tree geometry owner and primitive records must be present');
    }
    if (!sources.has(treeIndex)) {
      sources.set(treeIndex, {
        tree,
        indices: [],
        primitiveRefs: [],
        materialRefs: [],
      });
    }
    const source = sources.get(treeIndex);
    source.indices.push(index);
    source.primitiveRefs.push(primitive);
    source.materialRefs.push(materials.materials[index]);
  }
  return geometry.trees
    .filter((tree) => sources.has(tree.treeIndex))
    .map((tree) => sources.get(tree.treeIndex));
}

function sameReferences(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function createPacket(geometry, materials, source) {
  const count = source.indices.length;
  const primitiveIds = [];
  const primitiveKinds = new Uint8Array(count);
  const detailLevels = new Uint8Array(count);
  const parents = new Int32Array(count);
  const transforms = new Float32Array(count * 8);
  const materialKinds = new Uint8Array(count);
  const baseColors = new Float32Array(count * 4);
  const surfaceParams = new Float32Array(count * 4);
  const localIndexByGlobal = new Map(
    source.indices.map((globalIndex, localIndex) => [globalIndex, localIndex]),
  );

  source.indices.forEach((globalIndex, localIndex) => {
    primitiveIds.push(geometry.primitiveIds[globalIndex]);
    primitiveKinds[localIndex] = geometry.kinds[globalIndex];
    detailLevels[localIndex] = geometry.levels[globalIndex];
    const globalParent = geometry.parents[globalIndex];
    const localParent = globalParent < 0 ? -1 : localIndexByGlobal.get(globalParent);
    if (localParent === undefined) {
      throw new RangeError('tree primitive parent must belong to the same packet');
    }
    parents[localIndex] = localParent;
    transforms.set(
      geometry.transforms.subarray(globalIndex * 8, globalIndex * 8 + 8),
      localIndex * 8,
    );
    materialKinds[localIndex] = materials.materialKinds[globalIndex];
    baseColors.set(
      materials.baseColors.subarray(globalIndex * 4, globalIndex * 4 + 4),
      localIndex * 4,
    );
    surfaceParams.set(
      materials.surfaceParams.subarray(globalIndex * 4, globalIndex * 4 + 4),
      localIndex * 4,
    );
  });

  const vectorBytes = primitiveKinds.byteLength
    + detailLevels.byteLength
    + parents.byteLength
    + transforms.byteLength
    + materialKinds.byteLength
    + baseColors.byteLength
    + surfaceParams.byteLength;
  return Object.freeze({
    kind: 'tree-render-packet:v1',
    id: `tree:render:${source.tree.id}`,
    treeId: source.tree.id,
    treeIndex: source.tree.treeIndex,
    detailLevel: source.tree.detailLevel,
    primitiveCount: count,
    primitiveIds: Object.freeze(primitiveIds),
    primitiveKinds,
    detailLevels,
    parents,
    transforms,
    materialKinds,
    baseColors,
    surfaceParams,
    vectorBytes,
  });
}

function uploadSummary(packets) {
  return Object.freeze({
    packets: packets.length,
    primitives: packets.reduce((sum, packet) => sum + packet.primitiveCount, 0),
    bytes: packets.reduce((sum, packet) => sum + packet.vectorBytes, 0),
  });
}

export function adaptTreeWorkingSetsToRetainedPacketsReference(
  geometry,
  materials,
  previous = null,
) {
  requireWorkingSets(geometry, materials);
  const previousData = previous === null ? null : adapterMetadata.get(previous);
  if (previous !== null && !previousData) {
    throw new TypeError('retained tree render packet state is invalid');
  }
  const previousByTreeId = previousData?.byTreeId ?? new Map();
  const byTreeId = new Map();
  const packets = [];
  const upsert = [];
  const unchanged = [];

  for (const source of collectTreeSources(geometry, materials)) {
    const prior = previousByTreeId.get(source.tree.id);
    const retained = prior
      && sameReferences(prior.primitiveRefs, source.primitiveRefs)
      && sameReferences(prior.materialRefs, source.materialRefs);
    const packet = retained
      ? prior.packet
      : createPacket(geometry, materials, source);
    const entry = {
      packet,
      primitiveRefs: source.primitiveRefs,
      materialRefs: source.materialRefs,
    };
    byTreeId.set(source.tree.id, entry);
    packets.push(packet);
    if (retained) unchanged.push(packet.id);
    else upsert.push(packet);
  }

  const remove = [...previousByTreeId.entries()]
    .filter(([treeId]) => !byTreeId.has(treeId))
    .map(([, entry]) => entry.packet.id);
  const adapted = Object.freeze({
    kind: 'tree-render-packet-state:v1',
    packets: Object.freeze(packets),
    delta: Object.freeze({
      upsert: Object.freeze(upsert),
      remove: Object.freeze(remove),
      unchanged: Object.freeze(unchanged),
      upload: uploadSummary(upsert),
    }),
  });
  adapterMetadata.set(adapted, { byTreeId });
  return adapted;
}
