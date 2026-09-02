const HEADER_FLOATS = 4;
const RECORD_STRIDE_FLOATS = 8;
const MAX_SPECTRAL_SAMPLES = 64;
const PARITY_TOLERANCE = 1.0e-6;

export const WOOD_POLARIZATION_CONSUMER_WGSL = /* wgsl */`
@group(0) @binding(0)
var<storage, read> vf_wood_polarization_input: array<vec4<f32>>;

@group(0) @binding(1)
var<storage, read_write> vf_wood_polarization_output: array<vec4<f32>>;

@compute @workgroup_size(64)
fn vf_wood_polarization_consume(
  @builtin(global_invocation_id) id: vec3<u32>,
) {
  let record_count = (arrayLength(&vf_wood_polarization_input) - 1u) / 2u;
  let record = id.x;
  if (record >= record_count) {
    return;
  }
  let base_roughness = vf_wood_polarization_input[0u];
  let spectral_meta = vf_wood_polarization_input[1u + record * 2u];
  let stokes = vf_wood_polarization_input[2u + record * 2u];
  let visible = spectral_meta.x >= 380.0 && spectral_meta.x <= 780.0;
  let reflected_rgb = select(
    vec3<f32>(0.0),
    base_roughness.rgb * stokes.x,
    visible,
  );
  vf_wood_polarization_output[record * 2u] = vec4<f32>(
    reflected_rgb,
    stokes.x,
  );
  vf_wood_polarization_output[record * 2u + 1u] = vec4<f32>(
    stokes.yzw,
    spectral_meta.z,
  );
}
`;

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

function requireDescriptor(descriptor) {
  if (
    descriptor?.kind !== "wood-polarization-gpu:v1"
    || descriptor.headerFloats !== HEADER_FLOATS
    || descriptor.recordStrideFloats !== RECORD_STRIDE_FLOATS
    || !Number.isSafeInteger(descriptor.spectralSampleCount)
    || descriptor.spectralSampleCount < 1
    || !(descriptor.floats instanceof Float32Array)
    || descriptor.floats.length !== HEADER_FLOATS
      + descriptor.spectralSampleCount * RECORD_STRIDE_FLOATS
  ) {
    throw new TypeError("wood polarization GPU descriptor is required");
  }
}

function inputRecordOffset(record) {
  return HEADER_FLOATS + record * RECORD_STRIDE_FLOATS;
}

export function createWoodPolarizationGpuConsumptionFixture(descriptor) {
  requireDescriptor(descriptor);
  const expected = new Float32Array(
    descriptor.spectralSampleCount * RECORD_STRIDE_FLOATS,
  );
  let violations = 0;
  for (let record = 0; record < descriptor.spectralSampleCount; record += 1) {
    const inputOffset = inputRecordOffset(record);
    const outputOffset = record * RECORD_STRIDE_FLOATS;
    const wavelengthNm = descriptor.floats[inputOffset];
    const absorbedIntensity = descriptor.floats[inputOffset + 2];
    const reflectedIntensity = descriptor.floats[inputOffset + 4];
    const stokesQ = descriptor.floats[inputOffset + 5];
    const stokesU = descriptor.floats[inputOffset + 6];
    const stokesV = descriptor.floats[inputOffset + 7];
    const visible = wavelengthNm >= 380.0 && wavelengthNm <= 780.0;
    const colorScale = visible ? reflectedIntensity : 0.0;
    expected.set([
      descriptor.floats[0] * colorScale,
      descriptor.floats[1] * colorScale,
      descriptor.floats[2] * colorScale,
      reflectedIntensity,
      stokesQ,
      stokesU,
      stokesV,
      absorbedIntensity,
    ], outputOffset);
    const polarizedMagnitude = Math.hypot(stokesQ, stokesU, stokesV);
    if (
      reflectedIntensity < -PARITY_TOLERANCE
      || absorbedIntensity < -PARITY_TOLERANCE
      || polarizedMagnitude > reflectedIntensity + PARITY_TOLERANCE
      || Math.abs(
        reflectedIntensity + absorbedIntensity - 1.0
      ) > PARITY_TOLERANCE
    ) {
      violations += 1;
    }
  }
  return Object.freeze({
    source: WOOD_POLARIZATION_CONSUMER_WGSL,
    descriptor,
    inputFloats: descriptor.floats,
    expected,
    outputStrideFloats: RECORD_STRIDE_FLOATS,
    violations,
  });
}

export function verifyWoodPolarizationGpuConsumption(fixture, actual) {
  if (
    !fixture?.expected
    || !(actual instanceof Float32Array)
    || actual.length !== fixture.expected.length
  ) {
    throw new TypeError(
      "wood polarization GPU output has an invalid f32 length",
    );
  }
  let maxAbsoluteError = 0.0;
  for (let index = 0; index < actual.length; index += 1) {
    if (!Number.isFinite(actual[index])) {
      throw new RangeError(
        `wood polarization GPU output ${index} must be finite`,
      );
    }
    const error = Math.abs(actual[index] - fixture.expected[index]);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    if (error > PARITY_TOLERANCE) {
      return {
        matched: false,
        record: Math.floor(index / RECORD_STRIDE_FLOATS),
        lane: index % RECORD_STRIDE_FLOATS,
        expected: fixture.expected[index],
        actual: actual[index],
        tolerance: PARITY_TOLERANCE,
      };
    }
  }
  for (let record = 0; record < fixture.descriptor.spectralSampleCount;
    record += 1) {
    const outputOffset = record * RECORD_STRIDE_FLOATS;
    const reflectedIntensity = actual[outputOffset + 3];
    const polarizedMagnitude = Math.hypot(
      actual[outputOffset + 4],
      actual[outputOffset + 5],
      actual[outputOffset + 6],
    );
    const inputOffset = inputRecordOffset(record);
    const incidentIntensity = fixture.inputFloats[inputOffset + 2]
      + fixture.inputFloats[inputOffset + 4];
    if (
      reflectedIntensity < -PARITY_TOLERANCE
      || polarizedMagnitude > reflectedIntensity + PARITY_TOLERANCE
      || Math.abs(
        reflectedIntensity
        + actual[outputOffset + 7]
        - incidentIntensity
      ) > PARITY_TOLERANCE
    ) {
      return { matched: false, record, reason: "non-physical Stokes energy" };
    }
  }
  return {
    matched: true,
    records: actual.length / RECORD_STRIDE_FLOATS,
    maxAbsoluteError,
  };
}
