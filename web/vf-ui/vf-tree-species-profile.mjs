const PROFILES = Object.freeze([
  [0.98, 0.30, 0.72, 0.66, 0.14, 0.56, 1.20, 1.05, 0.56, 0.52, 7, 0.055],
  [1.04, 0.32, 0.69, 0.64, 0.11, 0.60, 1.08, 1.18, 0.58, 0.54, 9, 0.045],
  [0.92, 0.28, 0.74, 0.62, 0.17, 0.52, 1.28, 1.12, 0.52, 0.49, 6, 0.065],
  [1.08, 0.34, 0.67, 0.68, 0.09, 0.62, 1.16, 1.26, 0.60, 0.57, 10, 0.04],
  [0.96, 0.31, 0.71, 0.65, 0.13, 0.58, 1.24, 1.20, 0.55, 0.51, 8, 0.052],
].map((values, speciesIndex) => Object.freeze({
  kind: 'tree-species-profile:v1',
  speciesIndex,
  pathLength: Object.freeze({
    scaleMean: values[0],
    scaleDeviation: 0.075,
    scaleBounds: Object.freeze([0.78, 1.2]),
    rootConsumptionMean: values[1],
    rootConsumptionDeviation: 0.025,
  }),
  split: Object.freeze({
    areaLossMean: values[2],
    areaLossDeviation: 0.035,
    areaLossBounds: Object.freeze([0.6, 0.79]),
    mainAreaShareMean: values[3],
    mainAreaShareDeviation: 0.035,
    mainAreaShareBounds: Object.freeze([0.56, 0.73]),
    mainAngleMean: values[4],
    mainAngleDeviation: 0.035,
    mainAngleBounds: Object.freeze([0.045, 0.25]),
    lateralAngleMean: values[5],
    lateralAngleDeviation: 0.1,
    lateralAngleBounds: Object.freeze([0.3, 0.88]),
    mainBudgetRatio: Object.freeze([0.88, 0.98]),
    lateralBudgetRatio: Object.freeze([0.66, 0.88]),
  }),
  crownEnvelope: Object.freeze({
    axisScaleMean: Object.freeze([values[6], values[7], values[8]]),
    axisScaleDeviation: Object.freeze([0.08, 0.08, 0.045]),
    centerHeightMean: values[9],
    centerHeightDeviation: 0.035,
    centerHorizontalDeviation: 0.08,
    orientationDeviation: 0.42,
    localAttractionBounds: Object.freeze([0.28, 0.72]),
  }),
  twig: Object.freeze({
    foliageCountMean: 3,
    foliageCountDeviation: 0.65,
    foliageCountBounds: Object.freeze([2, 4]),
    attachmentBounds: Object.freeze([0.12, 0.9]),
  }),
  bark: Object.freeze({
    ridgeCountMean: values[10],
    ridgeCountDeviation: 1.1,
    ridgeCountBounds: Object.freeze([5, 12]),
    ridgeAmplitudeMean: values[11],
    ridgeAmplitudeDeviation: 0.012,
    ridgeAmplitudeBounds: Object.freeze([0.025, 0.085]),
    roughnessVariation: 0.08,
    colorVariation: 0.075,
    textureVariantWeights: Object.freeze([4 + speciesIndex, 3, 2 + (speciesIndex % 2)]),
  }),
})));

export function treeSpeciesProfileReference(speciesIndex) {
  if (!Number.isSafeInteger(speciesIndex) || speciesIndex < 0 || speciesIndex >= PROFILES.length) {
    throw new RangeError(`tree species profile index must be in [0, ${PROFILES.length - 1}]`);
  }
  return PROFILES[speciesIndex];
}
