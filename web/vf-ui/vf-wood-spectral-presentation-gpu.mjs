import {
  CIE_1931_2_DEGREE_DATASET,
  CIE_1931_2_DEGREE_SAMPLES,
} from "./vf-spectral-visible-color.mjs";
import {
  WOOD_SPECTRAL_PRESENTATION_LIMITS,
} from "./vf-wood-polarization-presentation.mjs";

const VERSION = 1;
const HEADER_VEC4_COUNT = 3;
const HEADER_FLOATS = HEADER_VEC4_COUNT * 4;
const PARITY_TOLERANCE = 2.0e-5;
const F32_DISPLAY_PEAK_CAP = Math.fround(1.0 - 2.0 ** -23);

export const WOOD_SPECTRAL_PRESENTATION_CONSUMER_WGSL = /* wgsl */`
@group(0) @binding(0)
var<storage, read> vf_material: array<vec4<f32>>;

@group(0) @binding(1)
var<storage, read_write> vf_presented: array<vec4<f32>>;

fn vf_reflected_radiance(
  wavelength_nm: f32,
  wood_offset: u32,
  sample_count: u32,
) -> f32 {
  let first_meta = vf_material[wood_offset + 1u];
  let last_meta = vf_material[wood_offset + 1u + 2u * (sample_count - 1u)];
  if (wavelength_nm < first_meta.x || wavelength_nm > last_meta.x) {
    return 0.0;
  }
  for (var sample = 0u; sample < sample_count; sample += 1u) {
    let spectral_meta = vf_material[wood_offset + 1u + 2u * sample];
    let stokes = vf_material[wood_offset + 2u + 2u * sample];
    if (wavelength_nm == spectral_meta.x) {
      return stokes.x;
    }
    if (wavelength_nm < spectral_meta.x) {
      let previous_meta = vf_material[wood_offset - 1u + 2u * sample];
      let previous_stokes = vf_material[wood_offset + 2u * sample];
      let amount = (wavelength_nm - previous_meta.x)
        / (spectral_meta.x - previous_meta.x);
      return mix(previous_stokes.x, stokes.x, amount);
    }
  }
  return 0.0;
}

@compute @workgroup_size(1)
fn vf_wood_spectral_present(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }
  let schema = vf_material[0u];
  let constants = vf_material[1u];
  let packed_layout = vf_material[2u];
  let basis_count = u32(schema.y);
  let sample_count = u32(schema.z);
  let wood_offset = 3u + basis_count;
  var xyz = vec3<f32>(0.0);
  var equal_energy_y = 0.0;
  for (var basis = 1u; basis < basis_count; basis += 1u) {
    let left = vf_material[3u + basis - 1u];
    let right = vf_material[3u + basis];
    let width = right.x - left.x;
    let left_radiance = vf_reflected_radiance(
      left.x,
      wood_offset,
      sample_count,
    );
    let right_radiance = vf_reflected_radiance(
      right.x,
      wood_offset,
      sample_count,
    );
    xyz += 0.5 * width
      * (left.yzw * left_radiance + right.yzw * right_radiance);
    equal_energy_y += 0.5 * width * (left.z + right.z);
  }
  xyz /= equal_energy_y;
  let linear_hdr = vec3<f32>(
    3.2409699419 * xyz.x - 1.5373831776 * xyz.y - 0.4986107603 * xyz.z,
    -0.9692436363 * xyz.x + 1.8759675015 * xyz.y + 0.0415550574 * xyz.z,
    0.0556300797 * xyz.x - 0.2039769589 * xyz.y + 1.0569715142 * xyz.z,
  );
  let exposed = max(linear_hdr, vec3<f32>(0.0)) * constants.x;
  let peak = max(exposed.x, max(exposed.y, exposed.z));
  var tone_scale = 1.0;
  if (peak > 0.0) {
    let display_peak = min(constants.z, peak / (1.0 + peak));
    tone_scale = display_peak / peak;
  }
  vf_presented[0u] = vec4<f32>(linear_hdr, packed_layout.z);
  vf_presented[1u] = vec4<f32>(exposed * tone_scale, schema.x);
}
`;

function requireWoodDescriptor(wood) {
  if (
    wood?.kind !== "wood-polarization-gpu:v1"
    || wood.headerFloats !== 4
    || wood.recordStrideFloats !== 8
    || !Number.isSafeInteger(wood.spectralSampleCount)
    || wood.spectralSampleCount < 2
    || !(wood.floats instanceof Float32Array)
  ) {
    throw new TypeError("wood polarization GPU descriptor is required");
  }
}

function requirePresentation(presentation) {
  if (
    presentation?.kind !== "wood-polarization-presentation:v1"
    || !Number.isFinite(presentation.exposureStops)
    || !Number.isFinite(presentation.exposureMultiplier)
    || !Array.isArray(presentation.linearHdrRgb)
    || presentation.linearHdrRgb.length !== 3
    || !Array.isArray(presentation.displayLinearRgb)
    || presentation.displayLinearRgb.length !== 3
  ) {
    throw new TypeError("wood spectral presentation is required");
  }
}

export function createWoodSpectralPresentationGpuDescriptorReference(
  wood,
  presentation,
) {
  requireWoodDescriptor(wood);
  requirePresentation(presentation);
  const basisRecordCount = CIE_1931_2_DEGREE_SAMPLES.length;
  const woodOffsetVec4 = HEADER_VEC4_COUNT + basisRecordCount;
  const woodOffsetFloats = woodOffsetVec4 * 4;
  const floats = new Float32Array(woodOffsetFloats + wood.floats.length);
  floats.set([
    VERSION,
    basisRecordCount,
    wood.spectralSampleCount,
    presentation.exposureStops,
    presentation.exposureMultiplier,
    WOOD_SPECTRAL_PRESENTATION_LIMITS.maximumLinearHdr,
    F32_DISPLAY_PEAK_CAP,
    CIE_1931_2_DEGREE_DATASET.minimumWavelengthNm,
    CIE_1931_2_DEGREE_DATASET.maximumWavelengthNm,
    CIE_1931_2_DEGREE_DATASET.stepNm,
    wood.headerFloats,
    wood.recordStrideFloats,
  ]);
  CIE_1931_2_DEGREE_SAMPLES.forEach((sample, index) => {
    floats.set(sample, HEADER_FLOATS + index * 4);
  });
  floats.set(wood.floats, woodOffsetFloats);
  return Object.freeze({
    kind: "wood-spectral-presentation-gpu:v1",
    version: VERSION,
    sourceWood: wood,
    sourcePresentation: presentation,
    headerVec4Count: HEADER_VEC4_COUNT,
    basisRecordCount,
    woodOffsetVec4,
    woodOffsetFloats,
    floats,
    byteLength: floats.byteLength,
  });
}

function requireDescriptor(descriptor) {
  if (
    descriptor?.kind !== "wood-spectral-presentation-gpu:v1"
    || descriptor.version !== VERSION
    || descriptor.headerVec4Count !== HEADER_VEC4_COUNT
    || descriptor.basisRecordCount !== CIE_1931_2_DEGREE_SAMPLES.length
    || descriptor.woodOffsetVec4 !== HEADER_VEC4_COUNT
      + descriptor.basisRecordCount
    || descriptor.woodOffsetFloats !== descriptor.woodOffsetVec4 * 4
    || !(descriptor.floats instanceof Float32Array)
    || descriptor.byteLength !== descriptor.floats.byteLength
  ) {
    throw new TypeError("wood spectral presentation descriptor is invalid");
  }
  if (descriptor.floats[0] !== VERSION) {
    throw new RangeError("wood spectral presentation version is invalid");
  }
  const expectedHeader = [
    VERSION,
    descriptor.basisRecordCount,
    descriptor.sourceWood.spectralSampleCount,
    descriptor.sourcePresentation.exposureStops,
    descriptor.sourcePresentation.exposureMultiplier,
    WOOD_SPECTRAL_PRESENTATION_LIMITS.maximumLinearHdr,
    F32_DISPLAY_PEAK_CAP,
    CIE_1931_2_DEGREE_DATASET.minimumWavelengthNm,
    CIE_1931_2_DEGREE_DATASET.maximumWavelengthNm,
    CIE_1931_2_DEGREE_DATASET.stepNm,
    descriptor.sourceWood.headerFloats,
    descriptor.sourceWood.recordStrideFloats,
  ].map(Math.fround);
  for (let index = 0; index < expectedHeader.length; index += 1) {
    if (descriptor.floats[index] !== expectedHeader[index]) {
      throw new RangeError(
        "wood spectral presentation header bytes are invalid",
      );
    }
  }
  const expectedLength = descriptor.woodOffsetFloats
    + descriptor.sourceWood.floats.length;
  if (descriptor.floats.length !== expectedLength) {
    throw new RangeError("wood spectral presentation byte layout is invalid");
  }
  CIE_1931_2_DEGREE_SAMPLES.forEach((sample, record) => {
    sample.forEach((value, lane) => {
      const offset = HEADER_FLOATS + record * 4 + lane;
      if (descriptor.floats[offset] !== Math.fround(value)) {
        throw new RangeError(
          "wood spectral presentation basis bytes are invalid",
        );
      }
    });
  });
  descriptor.sourceWood.floats.forEach((value, index) => {
    if (descriptor.floats[descriptor.woodOffsetFloats + index] !== value) {
      throw new RangeError(
        "wood spectral presentation wood bytes are invalid",
      );
    }
  });
}

export function createWoodSpectralPresentationGpuConsumptionFixture(
  descriptor,
) {
  requireDescriptor(descriptor);
  const presentation = descriptor.sourcePresentation;
  const expected = new Float32Array([
    ...presentation.linearHdrRgb,
    4.0,
    ...presentation.displayLinearRgb,
    1.0,
  ]);
  return Object.freeze({
    source: WOOD_SPECTRAL_PRESENTATION_CONSUMER_WGSL,
    descriptor,
    inputFloats: descriptor.floats,
    expected,
    outputStrideFloats: 4,
  });
}

export function verifyWoodSpectralPresentationGpuConsumption(
  fixture,
  actual,
) {
  if (
    !(fixture?.expected instanceof Float32Array)
    || !(actual instanceof Float32Array)
    || actual.length !== fixture.expected.length
  ) {
    throw new TypeError("wood spectral presentation GPU output is invalid");
  }
  let maxAbsoluteError = 0.0;
  for (let index = 0; index < actual.length; index += 1) {
    if (!Number.isFinite(actual[index])) {
      throw new RangeError("wood spectral presentation output must be finite");
    }
    const error = Math.abs(actual[index] - fixture.expected[index]);
    maxAbsoluteError = Math.max(maxAbsoluteError, error);
    if (error > PARITY_TOLERANCE) {
      return {
        matched: false,
        lane: index,
        expected: fixture.expected[index],
        actual: actual[index],
        tolerance: PARITY_TOLERANCE,
      };
    }
  }
  return { matched: true, maxAbsoluteError };
}
