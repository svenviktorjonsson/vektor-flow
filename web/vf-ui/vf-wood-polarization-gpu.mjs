const HEADER_FLOATS = 4;
const RECORD_STRIDE_FLOATS = 8;
const MAX_SPECTRAL_SAMPLES = 64;

function requireSourceSample(source) {
  if (
    source?.kind !== "wood-cut-polarized-sample:v1"
    || !Array.isArray(source.baseColor)
    || source.baseColor.length !== 3
    || !Number.isFinite(source.roughness)
    || source.roughness < 0.0
    || source.roughness > 1.0
    || !Number.isFinite(source.localCosThetaIncident)
    || source.localCosThetaIncident < 0.0
    || source.localCosThetaIncident > 1.0
    || !Array.isArray(source.spectralSamples)
    || source.spectralSamples.length < 1
  ) {
    throw new TypeError("wood polarized material sample is required");
  }
  source.spectralSamples.forEach((sample, index) => {
    if (
      !Number.isFinite(sample?.wavelengthNm)
      || !Number.isFinite(sample?.absorbedIntensity)
      || !Number.isFinite(sample?.degreeOfPolarization)
      || !Array.isArray(sample?.stokes)
      || sample.stokes.length !== 4
      || sample.stokes.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError(
        `wood polarized spectral sample ${index} is invalid`,
      );
    }
  });
}

function requireBudget(spectralSampleBudget, sampleCount) {
  if (
    !Number.isSafeInteger(spectralSampleBudget)
    || spectralSampleBudget < 1
    || spectralSampleBudget > MAX_SPECTRAL_SAMPLES
  ) {
    throw new RangeError(
      "wood polarization GPU spectralSampleBudget must be 1 through 64",
    );
  }
  if (sampleCount > spectralSampleBudget) {
    throw new RangeError(
      "wood polarization GPU samples exceed spectralSampleBudget",
    );
  }
}

export function createWoodPolarizationGpuDescriptorReference(
  sourceSample,
  { spectralSampleBudget },
) {
  requireSourceSample(sourceSample);
  requireBudget(
    spectralSampleBudget,
    sourceSample.spectralSamples.length,
  );
  const floats = new Float32Array(
    HEADER_FLOATS
    + sourceSample.spectralSamples.length * RECORD_STRIDE_FLOATS,
  );
  floats.set([
    ...sourceSample.baseColor,
    sourceSample.roughness,
  ]);
  sourceSample.spectralSamples.forEach((sample, index) => {
    const offset = HEADER_FLOATS + index * RECORD_STRIDE_FLOATS;
    floats.set([
      sample.wavelengthNm,
      sourceSample.localCosThetaIncident,
      sample.absorbedIntensity,
      sample.degreeOfPolarization,
      ...sample.stokes,
    ], offset);
  });
  return Object.freeze({
    kind: "wood-polarization-gpu:v1",
    sourceSample,
    headerFloats: HEADER_FLOATS,
    recordStrideFloats: RECORD_STRIDE_FLOATS,
    spectralSampleCount: sourceSample.spectralSamples.length,
    floats,
    byteLength: floats.byteLength,
  });
}

export function adaptWoodPolarizationToRendererPartReference(
  part,
  sourceSample,
  options,
) {
  if (!part || typeof part !== "object") {
    throw new TypeError("renderer part is required");
  }
  return Object.freeze({
    ...part,
    wood_polarization_gpu:
      createWoodPolarizationGpuDescriptorReference(
        sourceSample,
        options,
      ),
  });
}
