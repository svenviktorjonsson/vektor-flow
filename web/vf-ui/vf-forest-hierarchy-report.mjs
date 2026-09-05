function requireForestWorkingSet(workingSet) {
  if (
    !workingSet
    || workingSet.kind !== 'forest-patch-working-set:v1'
    || !Number.isSafeInteger(workingSet.treeCount)
    || workingSet.treeCount <= 0
    || !(workingSet.speciesIndices instanceof Uint32Array)
    || !(workingSet.growth instanceof Float32Array)
    || workingSet.speciesIndices.length !== workingSet.treeCount
    || workingSet.growth.length !== workingSet.treeCount * 4
  ) {
    throw new TypeError('non-empty forest patch working set is required');
  }
}

export function measureForestHeightHierarchyReference(workingSet) {
  requireForestWorkingSet(workingSet);
  const groups = new Map();
  let heightSum = 0;
  for (let tree = 0; tree < workingSet.treeCount; tree += 1) {
    const species = workingSet.speciesIndices[tree];
    const height = workingSet.growth[tree * 4 + 1];
    let group = groups.get(species);
    if (!group) {
      group = { count: 0, sum: 0, heights: [] };
      groups.set(species, group);
    }
    group.count += 1;
    group.sum += height;
    group.heights.push(height);
    heightSum += height;
  }

  const globalMean = heightSum / workingSet.treeCount;
  let totalSumSquares = 0;
  for (let tree = 0; tree < workingSet.treeCount; tree += 1) {
    const delta = workingSet.growth[tree * 4 + 1] - globalMean;
    totalSumSquares += delta * delta;
  }

  let withinSpeciesSumSquares = 0;
  let betweenSpeciesSumSquares = 0;
  const means = new Map();
  for (const [species, group] of groups) {
    const mean = group.sum / group.count;
    means.set(species, mean);
    for (const height of group.heights) {
      const delta = height - mean;
      withinSpeciesSumSquares += delta * delta;
    }
    const globalDelta = mean - globalMean;
    betweenSpeciesSumSquares += group.count * globalDelta * globalDelta;
  }

  const sortedSpecies = [...groups.keys()].sort(
    (first, second) => first - second,
  );
  const speciesIndices = Uint32Array.from(sortedSpecies);
  const sampleCounts = Uint32Array.from(
    sortedSpecies,
    (species) => groups.get(species).count,
  );
  const meanHeights = Float64Array.from(
    sortedSpecies,
    (species) => means.get(species),
  );
  return Object.freeze({
    kind: 'forest-height-hierarchy-report:v1',
    treeCount: workingSet.treeCount,
    speciesCount: sortedSpecies.length,
    speciesIndices,
    sampleCounts,
    meanHeights,
    globalMean,
    totalSumSquares,
    withinSpeciesSumSquares,
    betweenSpeciesSumSquares,
    explainedFraction: betweenSpeciesSumSquares / totalSumSquares,
    vectorBytes: speciesIndices.byteLength
      + sampleCounts.byteLength
      + meanHeights.byteLength,
  });
}
