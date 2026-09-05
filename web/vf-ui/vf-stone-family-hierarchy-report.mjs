function requireStoneWorkingSet(workingSet) {
  if (
    !workingSet
    || workingSet.kind !== 'stone-family-patch-working-set:v1'
    || !Number.isSafeInteger(workingSet.stoneCount)
    || workingSet.stoneCount <= 0
    || !Array.isArray(workingSet.patches)
    || !(workingSet.familyIndices instanceof Uint32Array)
    || workingSet.familyIndices.length !== workingSet.stoneCount
  ) {
    throw new TypeError('non-empty stone family working set is required');
  }
}

export function measureStoneFamilyHierarchyReference(workingSet) {
  requireStoneWorkingSet(workingSet);
  const familyCount = Math.max(...workingSet.familyIndices) + 1;
  const familyCounts = new Uint32Array(familyCount);
  for (const family of workingSet.familyIndices) familyCounts[family] += 1;

  const patchCount = workingSet.patches.length;
  const patchDominantFamilies = new Uint32Array(patchCount);
  const patchSampleCounts = new Uint32Array(patchCount);
  const patchMatchCounts = new Uint32Array(patchCount);
  let consumed = 0;
  let dominantMatchCount = 0;
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex += 1) {
    const patch = workingSet.patches[patchIndex];
    const sampleCount = Math.min(
      patch.count,
      workingSet.stoneCount - consumed,
    );
    let matchCount = 0;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      if (patch.familyIndices[sample] === patch.dominantFamily) {
        matchCount += 1;
      }
    }
    patchDominantFamilies[patchIndex] = patch.dominantFamily;
    patchSampleCounts[patchIndex] = sampleCount;
    patchMatchCounts[patchIndex] = matchCount;
    consumed += sampleCount;
    dominantMatchCount += matchCount;
  }
  if (consumed !== workingSet.stoneCount) {
    throw new TypeError('stone family patches do not cover the working set');
  }

  return Object.freeze({
    kind: 'stone-family-hierarchy-report:v1',
    stoneCount: workingSet.stoneCount,
    patchCount,
    familyCount,
    dominantMatchCount,
    dominantAffinity: dominantMatchCount / workingSet.stoneCount,
    familyCounts,
    patchDominantFamilies,
    patchSampleCounts,
    patchMatchCounts,
    vectorBytes: familyCounts.byteLength
      + patchDominantFamilies.byteLength
      + patchSampleCounts.byteLength
      + patchMatchCounts.byteLength,
  });
}
