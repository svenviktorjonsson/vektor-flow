function requireRoadWear(workingSet) {
  const sampleCount = workingSet?.sampleCount;
  if (
    workingSet?.kind !== 'road-wear-working-set:v1'
    || !Number.isSafeInteger(sampleCount)
    || sampleCount < 2
    || !(workingSet.geometry?.coordinates instanceof Float32Array)
    || !(workingSet.geometry?.displacement instanceof Float32Array)
    || !(workingSet.material?.roughness instanceof Float32Array)
    || !(workingSet.material?.albedo instanceof Float32Array)
    || workingSet.geometry.coordinates.length !== sampleCount * 3
    || workingSet.geometry.displacement.length !== sampleCount
    || workingSet.material.roughness.length !== sampleCount
    || workingSet.material.albedo.length !== sampleCount * 3
  ) {
    throw new TypeError('road wear working set with two samples is required');
  }
}

function canonicalIndices(coordinates, sampleCount) {
  return Array.from({ length: sampleCount }, (_, index) => index).sort(
    (first, second) => {
      for (let axis = 0; axis < 3; axis += 1) {
        const difference = coordinates[first * 3 + axis]
          - coordinates[second * 3 + axis];
        if (difference !== 0) return difference;
      }
      return first - second;
    },
  );
}

function mean(values) {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function correlation(first, second, firstMean, secondMean) {
  let firstSquares = 0;
  let secondSquares = 0;
  let products = 0;
  for (let index = 0; index < first.length; index += 1) {
    const firstDelta = first[index] - firstMean;
    const secondDelta = second[index] - secondMean;
    firstSquares += firstDelta * firstDelta;
    secondSquares += secondDelta * secondDelta;
    products += firstDelta * secondDelta;
  }
  return products / Math.sqrt(firstSquares * secondSquares);
}

export function measureRoadWearCorrelationReference(workingSet) {
  requireRoadWear(workingSet);
  const order = canonicalIndices(
    workingSet.geometry.coordinates,
    workingSet.sampleCount,
  );
  const displacement = [];
  const roughness = [];
  const luminance = [];
  for (const sample of order) {
    const colorOffset = sample * 3;
    displacement.push(workingSet.geometry.displacement[sample]);
    roughness.push(workingSet.material.roughness[sample]);
    luminance.push(
      workingSet.material.albedo[colorOffset] * 0.2126
        + workingSet.material.albedo[colorOffset + 1] * 0.7152
        + workingSet.material.albedo[colorOffset + 2] * 0.0722,
    );
  }
  const displacementMean = mean(displacement);
  const roughnessMean = mean(roughness);
  const luminanceMean = mean(luminance);
  const means = Float64Array.from([
    displacementMean,
    roughnessMean,
    luminanceMean,
  ]);
  const correlations = Float64Array.from([
    correlation(displacement, roughness, displacementMean, roughnessMean),
    correlation(displacement, luminance, displacementMean, luminanceMean),
  ]);
  return Object.freeze({
    kind: 'road-wear-correlation-report:v1',
    sampleCount: workingSet.sampleCount,
    means,
    correlations,
    vectorBytes: means.byteLength + correlations.byteLength,
  });
}
